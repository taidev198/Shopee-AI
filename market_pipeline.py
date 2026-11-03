"""Market analytics and persisted, locally trained market segmentation models."""
import json
import hashlib
import logging
import threading
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from market_analytics import build_analytics, product_metrics
from market_ml import train_market_model, score_market_model
from market_insights import build_insights


_training_lock = threading.Lock()
logger = logging.getLogger(__name__)


def install(app, db):
    router = APIRouter(prefix='/api/category-market')
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS market_ml_models(
          id TEXT PRIMARY KEY,created_at TEXT NOT NULL,status TEXT NOT NULL,
          algorithm TEXT NOT NULL,training_cutoff TEXT NOT NULL,
          product_count INTEGER NOT NULL,data_product_count INTEGER NOT NULL,
          artifact_json TEXT NOT NULL,data_cutoff TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS market_ml_predictions(
          model_id TEXT NOT NULL REFERENCES market_ml_models(id),sku TEXT NOT NULL,
          category_id TEXT NOT NULL,score REAL,segment TEXT NOT NULL,reason TEXT NOT NULL,
          prediction_json TEXT NOT NULL,PRIMARY KEY(model_id,sku,category_id));
        CREATE INDEX IF NOT EXISTS idx_market_ml_created ON market_ml_models(created_at);
        ''')
        if 'data_cutoff' not in {r['name'] for r in c.execute('PRAGMA table_info(market_ml_models)')}:
            c.execute("ALTER TABLE market_ml_models ADD COLUMN data_cutoff TEXT NOT NULL DEFAULT ''")
        if 'source_fingerprint' not in {r['name'] for r in c.execute('PRAGMA table_info(market_ml_models)')}:
            c.execute("ALTER TABLE market_ml_models ADD COLUMN source_fingerprint TEXT NOT NULL DEFAULT ''")
        c.execute('''CREATE TABLE IF NOT EXISTS market_learning_state(
          id INTEGER PRIMARY KEY CHECK(id=1),state TEXT NOT NULL,last_checked_at TEXT,
          last_success_at TEXT,last_error TEXT NOT NULL DEFAULT '')''')
        c.execute("INSERT OR IGNORE INTO market_learning_state(id,state) VALUES(1,'waiting')")

    def source_fingerprint(data):
        fields = ('category_id', 'sku', 'day', 'collected_at', 'price', 'sold_total', 'sold_approx', 'review_count', 'rating')
        values = sorted(([row.get(field) for field in fields] for row in data), key=lambda value: str(value[:4]))
        return hashlib.sha256(json.dumps(values, ensure_ascii=False, allow_nan=False).encode()).hexdigest()

    stop_learning = threading.Event()
    ready = threading.Event()
    worker = None
    interval_seconds = 30

    def learning_status():
        with db() as c:
            state = dict(c.execute('SELECT * FROM market_learning_state WHERE id=1').fetchone())
        return {**state, 'enabled': True, 'running': bool(worker and worker.is_alive()),
                'interval_seconds': interval_seconds, 'source': 'market_snapshots',
                'mode': 'automatic_on_database_change'}

    def rows():
        with db() as c:
            return [dict(r) for r in c.execute('''SELECT s.*,c.name AS category
              FROM market_snapshots s JOIN market_categories c ON c.id=s.category_id
              ORDER BY s.collected_at,s.category_id,s.sku''')]

    def latest_model(trained_only=False):
        with db() as c:
            records = c.execute('SELECT * FROM market_ml_models ' +
                            ("WHERE status='trained' " if trained_only else '') +
                            'ORDER BY created_at DESC,rowid DESC').fetchall()
        for row in records:
            record = dict(row)
            try:
                artifact = json.loads(record['artifact_json'])
                if not isinstance(artifact, dict):
                    raise ValueError('Model artifact must be an object')
                return record, artifact
            except (ValueError, TypeError):
                logger.warning('Skipping unreadable market model %s', record['id'])
        return None, None

    def model_info(record, artifact, scored=None, latest_at='', fingerprint=None):
        if not artifact:
            return {'status': 'waiting', 'reason': 'Chưa huấn luyện. Cần ít nhất 20 sản phẩm có giá, số bán và lượt đánh giá trong một ngành hàng.',
                    'algorithm': 'kmeans_standardized_log_features', 'trained_at': None,
                    'training_cutoff': None, 'training_product_count': 0, 'groups_count': 0,
                    'coverage_count': 0, 'model_id': None, 'stale': False, 'artifact_available': False}
        cutoff = artifact.get('training_cutoff') or ''
        return {'status': artifact.get('status', 'waiting'), 'reason': artifact.get('reason', ''),
                'algorithm': artifact.get('algorithm'), 'trained_at': artifact.get('trained_at'),
                'training_cutoff': cutoff, 'training_product_count': artifact.get('training_product_count', 0),
                'groups_count': len(artifact.get('groups', [])),
                'coverage_count': sum(p.get('ml_signal_score') is not None for p in (scored or {}).values()),
                'model_id': record['id'], 'stale': bool((fingerprint and fingerprint != record.get('source_fingerprint')) or
                    (latest_at and cutoff and latest_at > (record.get('data_cutoff') or cutoff))),
                'artifact_available': True}

    def train(force=False, refresh_changed=False):
        # Nonblocking automatic refresh cannot delay another training request or
        # discard a product checkpoint which has already committed successfully.
        if not _training_lock.acquire(blocking=force):
            record, artifact = latest_model()
            return model_info(record, artifact)
        try:
            with db() as c:
                counts = c.execute('SELECT COUNT(DISTINCT sku),MAX(collected_at) FROM market_snapshots').fetchone()
                eligible = {str(r[0]): r[1] for r in c.execute('''SELECT category_id,COUNT(DISTINCT sku)
                  FROM market_snapshots WHERE price>0 AND sold_total>=0 AND review_count>=0 GROUP BY category_id''')}
            count, latest_at = counts[0], counts[1] or ''
            previous, previous_artifact = latest_model()
            data = rows() if refresh_changed else None
            fingerprint = source_fingerprint(data) if data is not None else None
            scopes = {str(g.get('category_id')) for g in (previous_artifact or {}).get('groups', [])}
            new_scope = any(n >= 20 and cid not in scopes for cid, n in eligible.items())
            due = force or (not previous and count >= 20) or (
                previous and (count >= previous['data_product_count'] + 50 or
                              latest_at[:10] > (previous.get('data_cutoff') or previous['training_cutoff'])[:10] or
                              (new_scope and count >= previous['data_product_count'] + 20))) or (
                refresh_changed and (count >= 20 or previous is not None) and fingerprint != (previous or {}).get('source_fingerprint'))
            if not due:
                return model_info(previous, previous_artifact)
            data = rows() if data is None else data
            fingerprint = fingerprint or source_fingerprint(data)
            # Metadata and fingerprint describe the exact rows used for fit,
            # even if another collector commits while the CPU fit is running.
            count = len({row['sku'] for row in data})
            latest_at = max((row['collected_at'] or '' for row in data), default='')
            artifact = train_market_model(data)
            # The cutoff always refers to the actual source observation, even
            # when there is not enough data to train any category model yet.
            artifact['training_cutoff'] = artifact.get('training_cutoff') or latest_at
            predictions = score_market_model(artifact, data)
            model_id = uuid.uuid4().hex
            with db() as c:
                c.execute('BEGIN IMMEDIATE')
                c.execute('''INSERT INTO market_ml_models
                          (id,created_at,status,algorithm,training_cutoff,product_count,data_product_count,artifact_json,data_cutoff,source_fingerprint)
                          VALUES(?,?,?,?,?,?,?,?,?,?)''',
                          (model_id, artifact['trained_at'], artifact['status'], artifact['algorithm'],
                           artifact['training_cutoff'], artifact.get('training_product_count', 0), count,
                           json.dumps(artifact, ensure_ascii=False, allow_nan=False), latest_at, fingerprint))
                for sku, prediction in predictions.items():
                    if prediction.get('ml_signal_score') is None:
                        continue
                    c.execute('INSERT INTO market_ml_predictions VALUES(?,?,?,?,?,?,?)',
                              (model_id, sku, str(prediction.get('model_scope') or ''),
                               prediction['ml_signal_score'], prediction.get('segment', ''),
                               prediction.get('reason', ''), json.dumps(prediction, ensure_ascii=False, allow_nan=False)))
            return model_info({'id': model_id, 'data_cutoff': latest_at}, artifact, predictions, latest_at)
        finally:
            _training_lock.release()

    def learning_tick():
        checked = datetime.now(timezone.utc).isoformat()
        with db() as c:
            c.execute("UPDATE market_learning_state SET state='checking',last_checked_at=? WHERE id=1", (checked,))
        try:
            model = train(refresh_changed=True)
            with db() as c:
                c.execute('UPDATE market_learning_state SET state=?,last_success_at=?,last_error=\'\' WHERE id=1',
                          ('ready' if model['status'] == 'trained' else 'waiting', datetime.now(timezone.utc).isoformat()))
            return model
        except Exception as error:
            logger.exception('Automatic market learning failed; previous model and source data retained')
            with db() as c:
                c.execute("UPDATE market_learning_state SET state='error',last_error=? WHERE id=1", (str(error)[:500],))
            return None
        finally:
            ready.set()

    def learning_loop():
        while not stop_learning.is_set():
            learning_tick()
            if stop_learning.wait(interval_seconds):
                break

    def start_learning():
        nonlocal worker
        if worker and worker.is_alive():
            return
        stop_learning.clear()
        ready.clear()
        worker = threading.Thread(target=learning_loop, name='market-learning', daemon=True)
        worker.start()

    def stop_worker():
        stop_learning.set()
        if worker:
            worker.join(timeout=5)

    app.state.market_learning = SimpleNamespace(start=start_learning, stop=stop_worker, tick=learning_tick, ready=ready)

    def after_detail():
        if worker and worker.is_alive():
            # The independent worker reads committed rows at most 30s later.
            # Product checkpoint responses never wait for a CPU model fit.
            return
        try:
            train()
        except Exception:
            logger.exception('Market ML refresh failed; saved product checkpoint is retained')

    @router.get('/analysis')
    def analysis(category_id: str = '', days: int = Query(default=7, ge=1, le=365),
                 limit: int = Query(default=20, ge=1, le=100), all_rows: bool = False):
        data = rows()
        with db() as c:
            categories = [dict(r) for r in c.execute('SELECT * FROM market_categories ORDER BY name')]
            runs = [dict(r) for r in c.execute('''SELECT r.*,
              (SELECT COUNT(*) FROM market_queue q WHERE q.run_id=r.id) AS discovered,
              (SELECT COUNT(*) FROM market_queue q WHERE q.run_id=r.id AND q.status='done') AS completed
              FROM market_runs r''')]
        if category_id and category_id not in {str(c['id']) for c in categories}:
            raise HTTPException(404, 'Không tìm thấy ngành hàng')
        result = build_analytics(data, categories, runs, category_id=category_id, days=days, limit=limit, all_rows=all_rows)
        record, artifact = latest_model()
        retained = False
        if artifact and artifact.get('status') != 'trained':
            saved_record, saved_artifact = latest_model(trained_only=True)
            if saved_artifact:
                record, artifact, retained = saved_record, saved_artifact, True
        current_products = product_metrics(data, category_id=category_id, days=days)
        scored = score_market_model(artifact, current_products) if artifact else {}

        def enrich(product):
            prediction = scored.get(product['sku'], {})
            return {**product, 'ml_signal_score': prediction.get('ml_signal_score'),
                    'segment': prediction.get('segment'), 'ml_reason': prediction.get('reason'),
                    'model_scope': prediction.get('model_scope')}

        for key in ('top_products', 'trend_candidates'):
            result[key] = [enrich(p) for p in result.get(key, [])]
        candidates = [enrich(p) for p in current_products]
        result['ml_candidates'] = sorted((p for p in candidates if p['ml_signal_score'] is not None),
                                         key=lambda p: (-p['ml_signal_score'], p['sku']))[:None if all_rows else limit]
        result['model'] = model_info(record, artifact, scored, result.get('summary', {}).get('latest_at') or '', source_fingerprint(data))
        if retained:
            result['model']['reason'] += ' Dữ liệu hiện chưa đủ để học lại; đang giữ mô hình đã học trước đó.'
        result['learning'] = learning_status()
        result['insights'] = build_insights(result)
        result['generated_at'] = datetime.now(timezone.utc).isoformat()
        return result

    @router.post('/ml/train')
    def train_now():
        try:
            return {'model': train(force=True)}
        except Exception:
            logger.exception('Manual market ML training failed')
            raise HTTPException(503, 'Chưa huấn luyện được mô hình; dữ liệu sản phẩm đã lưu vẫn được giữ nguyên.')

    @router.get('/ml/export')
    def export_model():
        record, artifact = latest_model(trained_only=True)
        if not artifact:
            record, artifact = latest_model()
        if not artifact:
            raise HTTPException(404, 'Chưa có mô hình để xuất. Bấm Huấn luyện từ dữ liệu đã lưu.')
        return Response(json.dumps({'model_id': record['id'], **artifact}, ensure_ascii=False, allow_nan=False),
                        media_type='application/json',
                        headers={'Content-Disposition': 'attachment; filename="market-model.json"'})

    app.include_router(router)
    return after_detail

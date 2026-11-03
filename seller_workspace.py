"""Local seller workspace: declared costs, strategies, actions and saved reports."""
import json
import math
import uuid
import re
from datetime import datetime, timedelta, timezone
from html import escape
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, model_validator


def now():
    return datetime.now(timezone.utc)


class SellerInputs(BaseModel):
    model_config = ConfigDict(extra='forbid')
    unit_cost: float | None = Field(default=None, ge=0, le=1e12)
    platform_fee_pct: float | None = Field(default=None, ge=0, lt=100)
    payment_fee_pct: float | None = Field(default=None, ge=0, lt=100)
    tax_pct: float | None = Field(default=None, ge=0, lt=100)
    packaging_cost: float | None = Field(default=None, ge=0, le=1e12)
    shipping_cost: float | None = Field(default=None, ge=0, le=1e12)
    other_unit_cost: float | None = Field(default=None, ge=0, le=1e12)
    ad_cost_per_order: float | None = Field(default=None, ge=0, le=1e12)
    ad_spend: float | None = Field(default=None, ge=0, le=1e12)
    orders_30d: float | None = Field(default=None, ge=0, le=1e12)
    visits_30d: float | None = Field(default=None, ge=0, le=1e12)
    ad_revenue: float | None = Field(default=None, ge=0, le=1e15)
    target_margin_pct: float | None = Field(default=None, ge=0, lt=100)
    return_rate_pct: float | None = Field(default=None, ge=0, lt=100)
    ad_impressions: float | None = Field(default=None, ge=0, le=1e12)
    ad_clicks: float | None = Field(default=None, ge=0, le=1e12)
    ad_orders_30d: float | None = Field(default=None, ge=0, le=1e12)

    @model_validator(mode='before')
    @classmethod
    def reject_boolean_numbers(cls, values):
        if isinstance(values, dict) and any(isinstance(value, bool) for value in values.values()):
            raise ValueError('Các chỉ số cần là số, không nhận giá trị đúng/sai')
        return values

    @model_validator(mode='after')
    def finite_and_feasible(self):
        if any(value is not None and not math.isfinite(value) for value in self.model_dump().values()):
            raise ValueError('Chi phí và chỉ số phải là số hữu hạn')
        if any(value is not None and not value.is_integer() for value in
               (self.orders_30d, self.visits_30d, self.ad_impressions, self.ad_clicks, self.ad_orders_30d)):
            raise ValueError('Số đơn và lượt truy cập phải là số nguyên')
        if sum(value or 0 for value in (self.platform_fee_pct, self.payment_fee_pct, self.tax_pct)) >= 100:
            raise ValueError('Tổng tỷ lệ phí và thuế phải nhỏ hơn 100%')
        return self


class OptimizeRequest(BaseModel):
    sku: str = Field(min_length=1, max_length=200)
    inputs: SellerInputs | None = None


class ActionCreate(BaseModel):
    strategy_key: str = Field(min_length=1, max_length=300)
    sku: str = Field(default='', max_length=200)


class ActionUpdate(BaseModel):
    status: str | None = None
    notes: str | None = Field(default=None, max_length=4000)


class ReportCreate(BaseModel):
    period_days: int = 7


def install(app, db, report):
    router = APIRouter(prefix='/api/seller')
    ai_service = None
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS seller_product_inputs(
          shop_id TEXT NOT NULL REFERENCES shops(id),sku TEXT NOT NULL,
          inputs_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(shop_id,sku));
        CREATE TABLE IF NOT EXISTS seller_actions(
          id TEXT PRIMARY KEY,shop_id TEXT NOT NULL REFERENCES shops(id),sku TEXT NOT NULL,
          strategy_key TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'todo',priority REAL NOT NULL,confidence TEXT NOT NULL,
          due_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
          started_at TEXT,completed_at TEXT,notes TEXT NOT NULL DEFAULT '',
          evidence_json TEXT NOT NULL,baseline_json TEXT NOT NULL,plan_json TEXT NOT NULL DEFAULT '{}');
        CREATE INDEX IF NOT EXISTS idx_seller_actions_shop ON seller_actions(shop_id,created_at);
        CREATE TABLE IF NOT EXISTS seller_action_events(
          id INTEGER PRIMARY KEY AUTOINCREMENT,action_id TEXT NOT NULL REFERENCES seller_actions(id),
          status TEXT NOT NULL,notes TEXT NOT NULL,recorded_at TEXT NOT NULL,kpi_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS seller_reports(
          id TEXT PRIMARY KEY,shop_id TEXT NOT NULL REFERENCES shops(id),action_id TEXT,
          period_days INTEGER NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL,report_json TEXT NOT NULL,
          UNIQUE(action_id,period_days));
        ''')
        columns = {row['name'] for row in c.execute('PRAGMA table_info(seller_actions)')}
        if 'plan_json' not in columns:
            c.execute("ALTER TABLE seller_actions ADD COLUMN plan_json TEXT NOT NULL DEFAULT '{}'")

    def read_inputs(shop_id):
        with db() as c:
            return {row['sku']: json.loads(row['inputs_json']) for row in c.execute(
                'SELECT * FROM seller_product_inputs WHERE shop_id=?', (shop_id,))}

    def action_dict(row):
        data = dict(row)
        data['evidence'] = json.loads(data.pop('evidence_json'))
        data['baseline'] = json.loads(data.pop('baseline_json'))
        data['plan'] = json.loads(data.pop('plan_json', '{}'))
        return data

    def report_dict(row):
        return {key: value for key, value in dict(row).items() if key != 'report_json'} | json.loads(row['report_json'])

    def analysis_for(data):
        from seller_analytics import analyze_shop
        from seller_matching import competitor_reference
        inputs = read_inputs(data['shop']['id'])
        result = analyze_shop(data, inputs)
        references = {str(item['sku']): competitor_reference(item, data.get('market_products', []))
                      for item in data.get('own_products', [])}
        for item in result.get('products', []):
            reference = references.get(str(item.get('sku')), {})
            item['competitor_range'] = {key: value for key, value in reference.items() if key != 'candidates'}
        with db() as c:
            actions = [action_dict(row) for row in c.execute(
                'SELECT * FROM seller_actions WHERE shop_id=? ORDER BY priority DESC,created_at DESC', (data['shop']['id'],))]
            reports = [report_dict(row) for row in c.execute(
                'SELECT * FROM seller_reports WHERE shop_id=? ORDER BY created_at DESC', (data['shop']['id'],))]
        analysis = {**result, 'inputs': inputs, 'actions': actions, 'reports': reports,
                    'competitor_research': references,
                    'shop': data['shop'], 'is_demo': bool(data['shop'].get('is_demo')),
                    'generated_at': now().isoformat(), 'source': 'local_database'}
        return ai_service.enrich(analysis) if ai_service is not None else analysis

    def snapshot(shop_id):
        return analysis_for(report(shop_id, all_rows=True))

    def own_product(shop_id, sku):
        data = report(shop_id, all_rows=True)
        product = next((item for item in data.get('own_products', []) if str(item['sku']) == sku), None)
        if not product:
            raise HTTPException(404, 'Không tìm thấy SKU trong shop đang chọn')
        return product

    def validate_inputs(values):
        try:
            SellerInputs(**values)
        except ValueError as error:
            raise HTTPException(422, 'Kiểm tra lại chi phí: tổng phí/thuế phải nhỏ hơn 100% và các giá trị phải hợp lệ.') from error

    def baseline(data, sku=''):
        product = next((item for item in data.get('products', []) if str(item.get('sku')) == sku), None)
        return {'summary': data.get('summary', {}), 'product': product,
                'recorded_at': now().isoformat(), 'shop_id': data['shop']['id'], 'is_demo': data['is_demo']}

    @router.get('/analysis')
    def get_analysis(shop_id: str):
        return snapshot(shop_id)

    @router.get('/products/{sku}/market-evidence')
    def market_evidence(sku: str, shop_id: str):
        from seller_matching import competitor_reference
        source = report(shop_id, all_rows=True)
        product = next((item for item in source.get('own_products', []) if str(item['sku']) == sku), None)
        if product is None:
            raise HTTPException(404, 'Không tìm thấy SKU trong shop đang chọn')

        def number(value, maximum=None):
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value < 0:
                return None
            return value if maximum is None or value <= maximum else None

        reference = competitor_reference(product, source.get('market_products', []))
        candidates = {(str(item.get('sku')), str(item.get('source_shop') or '')): item
                      for item in source.get('market_products', [])}
        for item in reference['candidates']:
            observed = candidates.get((str(item.get('sku')), str(item.get('source_shop') or '')), {})
            detail = observed.get('detail') if isinstance(observed.get('detail'), dict) else {}
            sold_text, review_text = str(detail.get('sold_text') or ''), str(detail.get('review_count_text') or '')
            item.update(sold_total=number(observed.get('sold_total')), review_count=number(observed.get('review_count')),
                        rating=number(observed.get('rating'), 5), units_30d=number(observed.get('units_30d')),
                        units_basis=observed.get('units_basis'), snapshot_date=observed.get('snapshot_date'),
                        sold_approx=True if re.search(r'[kKmM+]', sold_text) else None,
                        sold_lower_bound=bool(observed.get('sold_lower_bound')),
                        review_approx=True if re.search(r'[kKmM+]', review_text) else None)
        with db() as c:
            observations = c.execute('''SELECT id,snapshot_date,price,sold_total,review_count,units_30d,revenue_30d,data_origin
              FROM observations WHERE shop_id=? AND role='own' AND sku=? ORDER BY id''', (shop_id, sku)).fetchall()
            prediction = None
            # A manual SKU label is not proof of identity with a public market SKU.
            try:
                url = urlparse(str(product.get('product_url') or ''))
                match = re.fullmatch(r'/product/(\d+)/(\d+)/?', url.path) or re.fullmatch(r'/[^/]+-i\.(\d+)\.(\d+)/?', url.path)
                public_identity = (url.scheme == 'https' and url.hostname in ('shopee.vn','www.shopee.vn') and
                                   not url.username and not url.password and not url.port and match and '.'.join(match.groups()) == sku)
            except ValueError:
                public_identity = False
            if public_identity:
                prediction = c.execute('''SELECT p.score,p.segment,p.reason,p.prediction_json,m.id AS model_id,m.created_at,
                  m.training_cutoff,m.algorithm FROM market_ml_predictions p JOIN market_ml_models m ON m.id=p.model_id
                  WHERE p.sku=? AND m.status='trained' ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1''', (sku,)).fetchone()
        daily = {}
        for row in observations:
            try:
                day = datetime.fromisoformat(str(row['snapshot_date'])).date().isoformat()
            except (TypeError, ValueError):
                continue
            daily[day] = {'day': day, **{key: number(row[key]) for key in
                ('price','sold_total','review_count','units_30d','revenue_30d')},
                'source': row['data_origin'], 'sold_precision': 'unknown', 'review_precision': 'unknown'}
        history = [daily[day] for day in sorted(daily)]
        ml = None
        if prediction is not None:
            ml = {key: prediction[key] for key in ('model_id','created_at','training_cutoff','algorithm','segment','reason')}
            ml.update(ml_signal_score=number(prediction['score'], 100), freshness='saved_not_revalidated',
                      basis='Vị thế thị trường từ mô hình đã lưu; chưa xác nhận độ mới và không phải dự báo tăng trưởng.')
        return {'shop_id': shop_id, 'sku': sku, 'competitors': reference, 'history': history,
                'history_basis': 'shop_observations', 'observation_days': len(history), 'ml': ml,
                'limitations': ['Số bán là bộ đếm cộng dồn được lưu; không phải số đơn trong một ngày.',
                    'Lịch sử shop chưa lưu độ chính xác của số hiển thị; không suy ra tốc độ tăng trưởng từ số có thể đã làm tròn.',
                    'Lượt đánh giá và lượt truy cập không đại diện cho lượng tìm kiếm trên Shopee, Google hoặc TikTok.'],
                'is_demo': bool(source['shop'].get('is_demo')), 'generated_at': now().isoformat(), 'source': 'local_database'}

    @router.put('/products/{sku}/inputs')
    def save_inputs(sku: str, payload: SellerInputs, shop_id: str):
        own_product(shop_id, sku)
        values = read_inputs(shop_id).get(sku, {}) | payload.model_dump(exclude_unset=True)
        validate_inputs(values)
        with db() as c:
            c.execute('''INSERT INTO seller_product_inputs VALUES(?,?,?,?)
              ON CONFLICT(shop_id,sku) DO UPDATE SET inputs_json=excluded.inputs_json,updated_at=excluded.updated_at''',
                      (shop_id, sku, json.dumps(values, ensure_ascii=False, allow_nan=False), now().isoformat()))
        return {'sku': sku, 'inputs': values, 'saved': True}

    @router.post('/optimize')
    def optimize(payload: OptimizeRequest, shop_id: str):
        from seller_analytics import analyze_shop
        source = report(shop_id, all_rows=True)
        product = next((item for item in source.get('own_products', []) if str(item['sku']) == payload.sku), None)
        if not product:
            raise HTTPException(404, 'Không tìm thấy SKU trong shop đang chọn')
        saved_inputs = read_inputs(shop_id)
        values = saved_inputs.get(payload.sku, {})
        if payload.inputs:
            values = values | payload.inputs.model_dump(exclude_unset=True)
            validate_inputs(values)
        from seller_matching import competitor_reference
        reference = competitor_reference(product, source.get('market_products', []))
        analysis = next(item for item in analyze_shop(source, saved_inputs | {payload.sku: values})['products']
                        if item['sku'] == payload.sku)
        return {'sku': payload.sku, 'product_name': product['name'], 'sales_plan': analysis['sales_plan'],
                'competitor_range': {key: value for key, value in reference.items() if key != 'candidates'},
                **analysis['optimizer']}

    @router.post('/actions')
    def create_action(payload: ActionCreate, shop_id: str):
        data = snapshot(shop_id)
        strategy = next((item for item in data.get('strategies_available', data.get('strategies', [])) if item['key'] == payload.strategy_key
                         and (not payload.sku or str(item.get('sku', '')) == payload.sku)), None)
        if not strategy:
            raise HTTPException(409, 'Khuyến nghị đã thay đổi. Làm mới phân tích rồi chọn lại.')
        sku = str(strategy.get('sku') or '')
        stamp = now()
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            previous = c.execute('''SELECT * FROM seller_actions WHERE shop_id=? AND strategy_key=? AND sku=?
              AND status!='done' ORDER BY created_at DESC LIMIT 1''', (shop_id, payload.strategy_key, sku)).fetchone()
            if previous:
                return action_dict(previous)
            action_id = uuid.uuid4().hex
            evidence = json.dumps(strategy.get('evidence', {}), ensure_ascii=False, allow_nan=False)
            base = json.dumps(baseline(data, sku), ensure_ascii=False, allow_nan=False)
            confidence = strategy.get('confidence_label') or strategy.get('confidence')
            if not isinstance(confidence, str):
                confidence = str(confidence if confidence is not None else 'Chưa rõ')
            description = strategy.get('action') or strategy.get('body') or ''
            if not isinstance(description, str):
                description = json.dumps(description, ensure_ascii=False)
            c.execute('''INSERT INTO seller_actions
              (id,shop_id,sku,strategy_key,title,description,status,priority,confidence,due_at,created_at,updated_at,evidence_json,baseline_json,plan_json)
              VALUES(?,?,?,?,?,?,'todo',?,?,?,?,?,?,?,?)''',
                      (action_id, shop_id, sku, payload.strategy_key, strategy['title'], description,
                       float(strategy.get('priority') or 0), confidence,
                       (stamp + timedelta(days=int(strategy.get('due_days') or 3))).isoformat(),
                       stamp.isoformat(), stamp.isoformat(), evidence, base,
                       json.dumps(strategy, ensure_ascii=False, allow_nan=False)))
            c.execute('INSERT INTO seller_action_events(action_id,status,notes,recorded_at,kpi_json) VALUES(?,?,?,?,?)',
                      (action_id, 'todo', '', stamp.isoformat(), base))
            return action_dict(c.execute('SELECT * FROM seller_actions WHERE id=?', (action_id,)).fetchone())

    @router.patch('/actions/{action_id}')
    def update_action(action_id: str, payload: ActionUpdate, shop_id: str):
        if payload.status is not None and payload.status not in ('todo', 'doing', 'done'):
            raise HTTPException(422, 'Trạng thái công việc không hợp lệ')
        data = snapshot(shop_id)
        with db() as c:
            row = c.execute('SELECT * FROM seller_actions WHERE id=? AND shop_id=?', (action_id, shop_id)).fetchone()
            if not row:
                raise HTTPException(404, 'Không tìm thấy công việc trong shop đang chọn')
            status, notes = payload.status or row['status'], payload.notes if payload.notes is not None else row['notes']
            stamp = now().isoformat()
            started = row['started_at'] or (stamp if status in ('doing', 'done') else None)
            completed = (row['completed_at'] or stamp) if status == 'done' else None
            base = json.dumps(baseline(data, row['sku']), ensure_ascii=False, allow_nan=False)
            c.execute('UPDATE seller_actions SET status=?,notes=?,updated_at=?,started_at=?,completed_at=?,baseline_json=? WHERE id=?',
                      (status, notes, stamp, started, completed,
                       base if not row['started_at'] and started else row['baseline_json'], action_id))
            c.execute('INSERT INTO seller_action_events(action_id,status,notes,recorded_at,kpi_json) VALUES(?,?,?,?,?)',
                      (action_id, status, notes, stamp, json.dumps(baseline(data, row['sku']), ensure_ascii=False, allow_nan=False)))
            return action_dict(c.execute('SELECT * FROM seller_actions WHERE id=?', (action_id,)).fetchone())

    def save_report(shop_id, data, days, action=None):
        stamp = now()
        comparisons = []
        current_product = None
        baseline_product = None
        if action:
            before = action['baseline'].get('summary', {})
            current = data.get('summary', {})
            if action['sku']:
                baseline_product = action['baseline'].get('product')
                current_product = next((item for item in data.get('products', []) if str(item.get('sku')) == action['sku']), None)
                before = (baseline_product or {}).get('metrics', {})
                current = (current_product or {}).get('metrics', {})
            for key in sorted(before.keys() & current.keys()):
                left, right = before[key], current[key]
                if (isinstance(left, (int, float)) and not isinstance(left, bool) and
                        isinstance(right, (int, float)) and not isinstance(right, bool)):
                    comparisons.append({'metric': key, 'before': left, 'after': right, 'delta': right-left,
                                        'delta_pct': (right-left)/abs(left)*100 if left else None})
        value = {'title': f"Đánh giá {days} ngày · {action['title']}" if action else f'Báo cáo shop · cửa sổ tham chiếu {days} ngày',
                 'status': 'comparison' if comparisons else ('insufficient' if action else 'snapshot'),
                 'summary': data.get('summary', {}), 'health': data.get('health', {}), 'comparison': comparisons,
                 'comparison_scope': 'sku' if action and action['sku'] else 'shop',
                 'product_baseline': baseline_product, 'product_current': current_product,
                 'generated_at': stamp.isoformat(), 'source': 'database', 'is_demo': data['is_demo'],
                 'limitations': ['Báo cáo mô tả dữ liệu ghi nhận, không khẳng định thay đổi do AI gây ra.',
                     'Chỉ số 30 ngày là cửa sổ của nguồn dữ liệu, không được đổi thành số đơn trong 7/14 ngày.',
                     'Lãi đóng góp dựa trên chi phí đã khai báo; chi phí còn thiếu phải được đối soát.']}
        report_id = uuid.uuid4().hex
        with db() as c:
            c.execute('INSERT OR IGNORE INTO seller_reports VALUES(?,?,?,?,?,?,?)',
                      (report_id, shop_id, action['id'] if action else None, days,
                       'action_review' if action else 'workspace_snapshot', stamp.isoformat(),
                       json.dumps(value, ensure_ascii=False, allow_nan=False)))
            row = c.execute('SELECT * FROM seller_reports WHERE id=?', (report_id,)).fetchone()
            if row is None and action:
                row = c.execute('SELECT * FROM seller_reports WHERE action_id=? AND period_days=?', (action['id'], days)).fetchone()
        return report_dict(row)

    @router.post('/reports')
    def create_report(payload: ReportCreate, shop_id: str):
        if payload.period_days not in (7, 14):
            raise HTTPException(422, 'Chọn cửa sổ 7 hoặc 14 ngày')
        return save_report(shop_id, snapshot(shop_id), payload.period_days)

    @router.get('/reports/{report_id}/export')
    def export_report(report_id: str, shop_id: str, format: str = Query(default='json')):
        with db() as c:
            row = c.execute('SELECT * FROM seller_reports WHERE id=? AND shop_id=?', (report_id, shop_id)).fetchone()
        if not row:
            raise HTTPException(404, 'Không tìm thấy báo cáo trong shop đang chọn')
        data = report_dict(row)
        if format == 'json':
            return Response(json.dumps(data, ensure_ascii=False, allow_nan=False), media_type='application/json',
                            headers={'Content-Disposition': f'attachment; filename="marketlens-report-{report_id[:8]}.json"'})
        if format != 'html':
            raise HTTPException(422, 'Định dạng phải là json hoặc html')
        body = f'''<!doctype html><html lang="vi"><meta charset="utf-8"><title>{escape(data['title'])}</title>
          <style>body{{font:16px/1.7 system-ui;max-width:1000px;margin:40px auto;padding:20px;color:#26344c}}
          pre{{white-space:pre-wrap;background:#f5f6fb;padding:20px;border-radius:12px}}</style>
          <h1>{escape(data['title'])}</h1><p>{escape(data['created_at'])}</p>
          <h2>Số liệu ghi nhận</h2><pre>{escape(json.dumps(data['summary'],ensure_ascii=False,indent=2))}</pre>
          <h2>Đối chiếu trước / sau</h2><pre>{escape(json.dumps(data['comparison'],ensure_ascii=False,indent=2))}</pre>
          <ul>{''.join('<li>'+escape(item)+'</li>' for item in data['limitations'])}</ul></html>'''
        return Response(body, media_type='text/html',
                        headers={'Content-Disposition': f'attachment; filename="marketlens-report-{report_id[:8]}.html"'})

    def report_tick():
        with db() as c:
            actions = [action_dict(row) for row in c.execute("SELECT * FROM seller_actions WHERE started_at IS NOT NULL")]
            completed = {(row['action_id'], row['period_days']) for row in c.execute(
                "SELECT action_id,period_days FROM seller_reports WHERE kind='action_review'")}
        cached = {}
        stamp = now()
        for action in actions:
            for days in (7, 14):
                if (action['id'], days) in completed or stamp < datetime.fromisoformat(action['started_at']) + timedelta(days=days):
                    continue
                if action['shop_id'] not in cached:
                    cached[action['shop_id']] = snapshot(action['shop_id'])
                save_report(action['shop_id'], cached[action['shop_id']], days, action)

    app.state.seller_analysis = analysis_for
    app.include_router(router)
    from seller_ai import install as install_seller_ai
    ai_service = install_seller_ai(app, db, snapshot)
    app.state.seller_ai = ai_service
    return report_tick

"""Choose a usable installed local chat model without downloads or inference."""
import math
import os
import re
import subprocess
import sys


GIB = 1024 ** 3
_EMBEDDING = re.compile(r'(?:embed|nomic-bert|\bbert\b|all-minilm|paraphrase|rerank|jina-|(?:^|[\s/_:-])(?:bge|e5|clip|siglip)(?:$|[\s/_:-]))', re.I)


def local_model_name(value):
    return (isinstance(value, str)
            and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,119}', value) is not None
            and '://' not in value
            and re.search(r'(?:^|[:/_-])cloud(?:$|[:/_-])', value.lower()) is None)


def physical_memory_bytes():
    """Physical RAM only; no network, environment overrides, or shell execution."""
    try:
        if 'SC_PHYS_PAGES' in os.sysconf_names:
            value = int(os.sysconf('SC_PAGE_SIZE')) * int(os.sysconf('SC_PHYS_PAGES'))
        elif sys.platform == 'darwin':
            result = subprocess.run(['/usr/sbin/sysctl', '-n', 'hw.memsize'], capture_output=True,
                                    text=True, timeout=1, check=True)
            value = int(result.stdout.strip())
        else:
            return None
        return value if value > 0 else None
    except (ValueError, OSError, subprocess.SubprocessError):
        return None


def _positive(value):
    try:
        return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0 else None
    except OverflowError:
        return None


def _parameters(value):
    match = re.search(r'(\d+(?:\.\d+)?)\s*([bBmM])(?:\b|_)', str(value or ''))
    return float(match[1]) * (1 if match[2].lower() == 'b' else .001) if match else None


def local_chat_models(values):
    if not isinstance(values, list):
        raise ValueError('Ollama model list is invalid')
    candidates = {}
    for item in values:
        if not isinstance(item, dict) or item.get('remote_host') or item.get('remote_model'):
            continue
        name = item.get('name') or item.get('model')
        if not local_model_name(name):
            continue
        details = item.get('details') if isinstance(item.get('details'), dict) else {}
        families = details.get('families') if isinstance(details.get('families'), list) else []
        labels = ' '.join(str(value) for value in [name, details.get('family'), *families])
        if _EMBEDDING.search(labels):
            continue
        capabilities = item.get('capabilities')
        if isinstance(capabilities, list) and capabilities and not any(value in ('completion', 'chat') for value in capabilities):
            continue
        parameters = _parameters(details.get('parameter_size')) or _parameters(name)
        size = _positive(item.get('size'))
        candidates[name] = {'name': name, 'size_bytes': size, 'parameters_b': parameters,
                            'memory_estimated': size is None}
    return sorted(candidates.values(), key=lambda item: item['name'])


def select_local_chat_model(values, preferred='', memory_bytes=None):
    """Prefer a comfortable installed model, rather than the largest weights.

    This is a resource policy, not a benchmark or prediction of model quality.
    Model weights plus reserved context must fit the local memory budget. When
    metadata is missing, parameter count supplies a conservative estimate.
    """
    candidates = local_chat_models(values)
    known_ram = _positive(memory_bytes)
    ram_gib = known_ram / GIB if known_ram is not None else 8
    budget = max(.5, ram_gib * .60 - 1.5)
    target = min(14, max(1, ram_gib * .40))
    usable = []
    for candidate in candidates:
        parameters = candidate['parameters_b']
        weights = candidate['size_bytes'] / GIB if candidate['size_bytes'] else max(1, (parameters or 3) * .75)
        if weights > budget:
            continue
        # A very large model is unnecessary for a bounded SKU text plan, even
        # when a high-memory machine could load it. Installed smaller models
        # remain the more comfortable default for interactive analysis.
        distance = abs(math.log2(max(.1, parameters or weights * 1.5) / target))
        preferred_fit = candidate['name'] == preferred and (parameters is None or parameters <= target * 1.5)
        usable.append((not preferred_fit, distance, weights, candidate['name'], candidate))
    chosen = min(usable, default=None)
    model = chosen[-1]['name'] if chosen else ''
    if not candidates:
        reason = 'Ollama chưa có model chat cục bộ phù hợp; model cloud và embedding không được dùng.'
    elif not chosen:
        reason = 'Các model chat đã cài vượt ngân sách RAM cho phân tích SKU. Chưa chạy model.'
    elif model == preferred:
        reason = 'Tự chọn model chat đã cài phù hợp với bộ nhớ máy.'
    else:
        reason = 'Tự chọn model chat cục bộ phù hợp; không cần chọn model thủ công.'
    return {'model': model, 'selected_model': model, 'selection_mode': 'auto',
            'installed_models': [item['name'] for item in candidates],
            'machine_memory_gb': round(known_ram / GIB, 1) if known_ram is not None else None,
            'selection_reason': reason, 'model_installed': bool(model)}

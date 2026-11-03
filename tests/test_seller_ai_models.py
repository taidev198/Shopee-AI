"""Automatic selection tests use declared RAM and installed-model metadata only."""
import math

import pytest

import seller_ai_models as models


def entry(name, parameters, size_gb, **extra):
    return {'name':name,'size':size_gb*models.GIB,
            'details':{'parameter_size':parameters,'family':'qwen3'},**extra}


def test_only_local_chat_candidates_survive_names_metadata_and_capability_filters():
    values=[entry('qwen3.5:9b','9B',6),entry('qwen3:4b','4B',3),
            {'name':'qwen3.5:cloud'}, {'name':'qwen3:9b-cloud'},
            {'name':'local-remote','remote_model':'qwen3:cloud'},
            {'name':'local-remote-host','remote_host':'https://example.com'},
            {'name':'nomic-embed-text:latest'}, {'name':'bge-m3:latest'},
            {'name':'custom-embedding','details':{'family':'bert'}},
            {'name':'renamed','details':{'family':'nomic-bert'}},
            {'name':'opaque-vector','capabilities':['embedding']},
            {'name':'vision-vector','details':{'family':'clip'}},
            {'name':'https://example.com/model'}, {'name':'../model'}, {'name':'x\nheader'}, None]
    assert [row['name'] for row in models.local_chat_models(values)]==['qwen3.5:9b','qwen3:4b']


def test_32gb_machine_prefers_comfortable_9b_over_largest_installed_model():
    values=[entry('qwen3.5:9b','9B',6),entry('big:27b','27B',17),entry('huge:70b','70B',42)]
    result=models.select_local_chat_model(values,'missing-preference',32*models.GIB)
    assert result['model']=='qwen3.5:9b'
    assert result['selection_mode']=='auto' and result['model_installed'] is True
    assert result['machine_memory_gb']==32
    assert models.select_local_chat_model(list(reversed(values)),'',32*models.GIB)['model']==result['model']


def test_small_machine_falls_back_from_preferred_9b_without_loading_oversized_weights():
    values=[entry('qwen3.5:9b','9B',6),entry('chat:3b','3B',2)]
    assert models.select_local_chat_model(values,'qwen3.5:9b',8*models.GIB)['model']=='chat:3b'
    assert models.select_local_chat_model(values[:1],'qwen3.5:9b',8*models.GIB)['model']==''


def test_actual_weight_size_wins_over_name_and_unknown_ram_is_conservative():
    values=[entry('qwen:9b-f16','9B',18),entry('qwen:4b-q4','4B',2.5)]
    assert models.select_local_chat_model(values,values[0]['name'],32*models.GIB)['model']==values[1]['name']
    result=models.select_local_chat_model([{'name':'qwen:9b'},{'name':'qwen:4b'}],memory_bytes=None)
    assert result['model']=='qwen:4b' and result['machine_memory_gb'] is None


@pytest.mark.parametrize('memory',[False,0,-1,math.nan,math.inf,2**10000])
def test_invalid_memory_metadata_does_not_claim_unbounded_resources(memory):
    result=models.select_local_chat_model([{'name':'qwen:4b'},{'name':'huge:70b'}],memory_bytes=memory)
    assert result['model']=='qwen:4b' and result['machine_memory_gb'] is None


def test_embedding_only_or_oversized_catalog_has_no_selected_model():
    result=models.select_local_chat_model([{'name':'embeddinggemma:latest'}],memory_bytes=32*models.GIB)
    assert result['model']=='' and result['installed_models']==[] and result['model_installed'] is False
    assert 'embedding' in result['selection_reason']
    result=models.select_local_chat_model([entry('giant:100b','100B',65)],memory_bytes=32*models.GIB)
    assert not result['model_installed'] and 'RAM' in result['selection_reason']


def test_ram_detection_uses_local_sysconf_without_spawning_when_available(monkeypatch):
    monkeypatch.setattr(models.os,'sysconf_names',{'SC_PHYS_PAGES':1,'SC_PAGE_SIZE':2})
    monkeypatch.setattr(models.os,'sysconf',lambda key:16384 if key=='SC_PAGE_SIZE' else 2097152)
    monkeypatch.setattr(models.subprocess,'run',lambda *args,**kwargs:pytest.fail('No subprocess is necessary'))
    assert models.physical_memory_bytes()==32*models.GIB


def test_invalid_catalog_is_rejected_instead_of_becoming_an_installed_model():
    with pytest.raises(ValueError):
        models.select_local_chat_model({'name':'qwen:4b'},memory_bytes=32*models.GIB)

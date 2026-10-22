/* Planejamento puro de lançamento: o executor lê novamente cada talão em transação. */
(function (root) {
  'use strict';
  const sectors = Object.freeze({
    costura:{owner:'atelieCosturaId',name:'idAtelieResponsavel',source:'origemAtelieCostura',distribution:'distribuicaoCosturaId',status:'statusCostura',start:'costuraDataInicio',end:'dataSaidaCostura'},
    palmilha:{owner:'ateliePalmilhaId',name:'idAteliePalmilhaResponsavel',source:'origemAteliePalmilha',distribution:'distribuicaoPalmilhaId',status:'statusPalmilha',start:'palmilhaDataInicio',end:'dataSaidaPalmilha'},
    sola:{owner:'atelieSolaId',name:'idAtelieSolaResponsavel',source:'origemAtelieSola',distribution:'distribuicaoSolaId',status:'statusSola',start:'solaDataInicio',end:'dataSaidaSola'}
  });
  function text(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
  function isoDate(value) {
    if (value?.toDate) value = value.toDate();
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
    const str = String(value || '').trim();
    const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const br = str.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
    return br ? `${br[3]}-${br[2]}-${br[1]}` : '';
  }
  function origins(item) {
    const result = new Set();
    (Array.isArray(item.origens) ? item.origens : []).forEach(v => result.add(String(v)));
    String(item.origensTexto || '').split('|').filter(Boolean).forEach(v => result.add(v));
    Object.values(item.origensMap || {}).forEach(v => result.add(String(v)));
    Object.entries(item.paresPorOrigem || {}).forEach(([key,value]) => { if (Number(value)>0) result.add(key); });
    return [...result];
  }
  function resolveAtelier(item, directory, sector) {
    const active = directory.filter(a => a.ativo === true && a.setor === sector);
    if (item.atelierId) return active.find(a => a.id === item.atelierId) || null;
    const found = active.filter(a => text(a.nome) === text(item.atelier));
    return found.length === 1 ? found[0] : null;
  }
  function applicable(talao, sector) { return sector === 'costura' || root.RomaModelos.components(talao)[sector] === true; }
  function started(talao, sector) {
    const f = sectors[sector];
    return Boolean(talao[f.start] || talao[f.end]) || ['em producao','finalizado','concluido'].includes(text(talao[f.status]));
  }
  function prepare({sector,allocation,selectedDocs,directory,distributionId}) {
    if (!sectors[sector] || !distributionId) throw new Error('Setor ou distribuição inválidos.');
    const selected = new Set(selectedDocs || []), groups = new Map();
    for (const item of allocation || []) {
      const key = root.RomaModelos.modelKey(item.linha,item.modelo);
      if (!key || !(Number(item.pares)>0)) continue;
      if (!groups.has(key)) groups.set(key,{key,items:[],destinations:new Set(),origins:new Set(),invalid:false});
      const group = groups.get(key), atelier = resolveAtelier(item,directory,sector);
      group.items.push(item);
      if (!atelier) group.invalid = true;
      else { group.destinations.add(atelier.id); group.atelier = atelier; }
      const itemOrigins = origins(item).filter(source => selected.has(source));
      if (!itemOrigins.length) group.invalid = true;
      itemOrigins.forEach(source => { const date = isoDate(source); if (date) group.origins.add(date); else group.invalid = true; });
    }
    for (const group of groups.values()) {
      group.split = group.items.length > 1 || group.destinations.size > 1 || group.items.some(i => i.dividido === true);
      if (group.destinations.size !== 1 || group.origins.size === 0) group.invalid = true;
    }
    return {sector,distributionId,groups};
  }
  function uniqueDestinations(plan) {
    const result = {};
    for (const group of plan.groups.values()) {
      if (group.split || group.invalid) continue;
      const [line,model] = group.key.split('.');
      const keys = new Set([group.key]);
      group.items.forEach(item => {
        const rawLine = String(item.linha || '').replace(/\D/g,'');
        let rawModel = String(item.modelo || '').replace(/\D/g,'');
        const parts = String(item.modelo || '').match(/^(\d+)[.\-_/](\d+)$/);
        if (parts) rawModel = parts[2];
        keys.add(`${rawLine}.${rawModel}`);
      });
      keys.forEach(key => { result[key] = group.atelier.id; });
    }
    return result;
  }
  function decide(plan,talao) {
    const group = plan.groups.get(root.RomaModelos.modelKey(talao.linha,talao.modelo));
    if (!group || !group.origins.has(isoDate(talao.dataCorte))) return {reason:'foraDaDistribuicao'};
    if (typeof talao.dataCorte !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(talao.dataCorte)) return {reason:'formatoAntigo'};
    if (!applicable(talao,plan.sector)) return {reason:'naoSeAplica'};
    if (group.split) return {reason:'dividido'};
    if (group.invalid) return {reason:'semAtelie'};
    const f = sectors[plan.sector];
    if (['corte','migracao'].includes(talao[f.source])) return {reason:'manualPreservado'};
    if (started(talao,plan.sector)) return {reason:'iniciadoPreservado'};
    if (talao[f.owner] && talao[f.source] !== 'distribuicao') return {reason:'manualPreservado'};
    // Uma atribuição antiga por nome ainda precisa ser reconciliada pelo Admin/Corte.
    if (!talao[f.owner] && talao[f.name] && !talao[f.source]) return {reason:'manualPreservado'};
    const patch = {[f.owner]:group.atelier.id,[f.name]:group.atelier.nome,[f.source]:'distribuicao',[f.distribution]:plan.distributionId};
    if (Object.entries(patch).every(([key,value]) => talao[key] === value)) return {reason:'jaLancado'};
    return {reason:'atribuir',patch};
  }
  function preview(plan,taloes) {
    const counts = {}, assignments = [];
    (taloes || []).forEach(t => { const result = decide(plan,t); counts[result.reason] = (counts[result.reason] || 0)+1; if (result.patch) assignments.push({id:t.id,patch:result.patch}); });
    return {counts,assignments};
  }
  root.RomaDistribuicao = Object.freeze({sectors,isoDate,origins,resolveAtelier,applicable,started,prepare,uniqueDestinations,decide,preview});
})(typeof window !== 'undefined' ? window : globalThis);

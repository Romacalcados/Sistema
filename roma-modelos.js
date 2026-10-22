/* Projeções explícitas: nunca copie o documento financeiro inteiro para coleções operacionais. */
(function (root) {
  'use strict';
  const labels = Object.freeze({cabedal:'Cabedal',forro:'Forro',tiras:'Tiras',aviamentos:'Aviamentos',palmilha:'Palmilha',sola:'Sola'});
  const legacy = Object.freeze({cabedal:true,forro:true,tiras:true,aviamentos:true,palmilha:false,sola:false});
  function normalizeText(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
  function components(data) {
    const source = data && data.componentes;
    if (!source || typeof source !== 'object' || !Object.keys(labels).some(key => typeof source[key] === 'boolean')) return {...legacy};
    const result = {};
    Object.keys(labels).forEach(key => { result[key] = source[key] === true; });
    return result;
  }
  function modelKey(linha, modelo) {
    let line = String(linha || '').replace(/\D/g, '');
    let value = String(modelo || '').trim();
    const parts = value.match(/^(\d+)[.\-_/](\d+)$/);
    if (parts && (!line || Number(parts[1]) === Number(line))) { line = line || parts[1]; value = parts[2]; }
    const model = value.replace(/\D/g, '');
    if (!line || !model) return '';
    return `${Number(line)}.${Number(model)}`;
  }
  function sectorPrice(model, sector) {
    const entries = Object.entries(model?.preco?.setores || {});
    const canonical = entries.find(([name]) => normalizeText(name) === sector);
    const entry = canonical || (sector === 'sola' ? entries.find(([name]) => ['pre','pre fabricado','pre-fabricado','prefabricado'].includes(normalizeText(name))) : null);
    const price = Number(entry?.[1] || 0);
    return Number.isFinite(price) && price >= 0 ? Math.round(price * 1000) / 1000 : 0;
  }
  function projections(model, timestamp) {
    const operacional = {
      linha:String(model?.linha || ''),modelo:String(model?.modelo || ''),categoria:String(model?.categoria || ''),
      subcategoria:String(model?.subcategoria || ''),chave:String(model?.chave || model?.id || modelKey(model?.linha,model?.modelo)),
      observacaoModelo:String(model?.observacaoModelo || model?.observacao || ''),ativo:model?.ativo !== false,componentes:components(model),
      atualizadoEm:timestamp
    };
    const precos = {linha:operacional.linha,modelo:operacional.modelo,costura:sectorPrice(model,'costura'),palmilha:sectorPrice(model,'palmilha'),sola:sectorPrice(model,'sola'),atualizadoEm:timestamp};
    return {operacional,precos};
  }
  root.RomaModelos = Object.freeze({labels,legacy,components,modelKey,sectorPrice,projections});
})(typeof window !== 'undefined' ? window : globalThis);

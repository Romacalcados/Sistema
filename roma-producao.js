/* Cálculos compartilhados dos cronogramas e do giro.
   Componentes ausentes não criam pendências; etapas de ateliê são independentes. */
(function (root) {
  'use strict';
  const STAGES = Object.freeze(['corte', 'costura', 'palmilha', 'sola', 'distribuicao', 'talonagem', 'montagem']);
  const LABELS = Object.freeze({corte:'Corte',costura:'Costura',palmilha:'Palmilha',sola:'Sola',distribuicao:'Distribuição',talonagem:'Talonagem',montagem:'Montagem'});
  const END_FIELDS = Object.freeze({costura:'dataSaidaCostura',palmilha:'dataSaidaPalmilha',sola:'dataSaidaSola',distribuicao:'dataEntradaDistribuicao',talonagem:'dataEntradaTalonagem',montagem:'dataEntradaMontagem'});
  function hasDate(value) { return !!value && value !== 'N/A' && value !== 'Não se aplica'; }
  function dateISO(value) {
    if (!hasDate(value)) return '';
    const d = value?.toDate ? value.toDate() : value instanceof Date ? value : null;
    if (d) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const text=String(value).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0,10) : '';
  }
  function applicable(t,stage) {
    if (stage==='corte') return root.Roma.CUT_COMPONENTS.some(key=>root.Roma.requiresComponent(t,key));
    if (stage==='palmilha'||stage==='sola') return root.Roma.stageApplicable(t,stage);
    return true;
  }
  function complete(t,stage) {
    if (!applicable(t,stage)) return true;
    if (stage==='corte') return root.Roma.cutComplete(t);
    if (['costura','palmilha','sola'].includes(stage)) return root.Roma.stageComplete(t,stage);
    return hasDate(t?.[END_FIELDS[stage]]);
  }
  function missing(t,stage) { return applicable(t,stage) && !complete(t,stage); }
  function completedDate(t,stage) {
    if (!applicable(t,stage) || !complete(t,stage)) return '';
    return stage==='corte' ? root.Roma.cutCompletionDate(t) || '' : dateISO(t?.[END_FIELDS[stage]]);
  }
  function emptyStage() { return {paresFaltando:0,taloesFaltando:0,allDone:true,maxDate:null,aplicaveis:0}; }
  function addToStage(group,t,stage) {
    if (!applicable(t,stage)) return group;
    group.aplicaveis++;
    if (missing(t,stage)) {
      group.paresFaltando+=Number(t.pares)||0;
      group.taloesFaltando++;
      group.allDone=false;
    } else {
      const date=completedDate(t,stage);
      if(date && (!group.maxDate || date>group.maxDate)) group.maxDate=date;
    }
    return group;
  }
  function pendingTotals(taloes) {
    return Object.fromEntries(STAGES.map(stage=>[stage,(taloes||[]).filter(t=>missing(t,stage)).reduce((sum,t)=>sum+(Number(t.pares)||0),0)]));
  }
  function detail(t,stage,formatDate) {
    if(!applicable(t,stage)) return '<span class="stage-na" title="Este componente não faz parte do modelo">Não se aplica</span>';
    if(!complete(t,stage)) return '<span class="stage-pending">Pendente</span>';
    const date=completedDate(t,stage);
    return `<span class="status-check">✔ ${date ? formatDate(date) : 'Concluído'}</span>`;
  }
  function escape(value) { return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function entryDetail(t,sector,formatDate) {
    if(!applicable(t,sector)) return '<span class="stage-na">Não se aplica</span>';
    const date=dateISO(t?.[root.Roma.SECTORS[sector].start]);
    return date ? `✔ ${formatDate(date)}` : '—';
  }
  root.RomaProducao=Object.freeze({STAGES,LABELS,END_FIELDS,applicable,complete,missing,completedDate,emptyStage,addToStage,pendingTotals,detail,entryDetail,escape,dateISO});
})(typeof window!=='undefined'?window:globalThis);

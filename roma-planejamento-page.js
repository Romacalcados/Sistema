/* Interface do planejamento. As previsões são independentes da montagem realizada. */
(function (root) {
  'use strict';

  let started = false;
  const $ = id => document.getElementById(id);
  const text = value => String(value ?? '').trim();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const number = value => Number(value || 0).toLocaleString('pt-BR');
  const pairs = row => Number.isFinite(Number(row.pares)) ? Math.max(0, Number(row.pares)) : 0;
  const sumPairs = records => records.reduce((total, row) => total + pairs(row), 0);
  const normalized = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : '—';
  const addDays = (iso, count) => {
    const date = new Date(`${iso}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
  };

  function message(id, content, type = 'info') {
    const element = $(id);
    element.textContent = content;
    element.className = `planning-message ${type}`;
    element.hidden = !content;
    element.setAttribute('role', type === 'error' ? 'alert' : 'status');
  }

  function errorText(error) {
    const code = text(error?.code);
    if (code.includes('permission-denied')) return 'Sem permissão para esta operação. Peça ao Admin para conferir o perfil e publicar as regras atualizadas do planejamento no Firebase.';
    if (code.includes('unavailable') || code.includes('network')) return 'Não foi possível confirmar a operação com o banco. Verifique a conexão e consulte os dados novamente.';
    if (code.includes('failed-precondition')) return 'O banco não conseguiu concluir esta consulta. Peça ao Admin para verificar a configuração do Firestore.';
    return error?.message || 'Não foi possível concluir a operação. Atualize a consulta e tente novamente.';
  }

  function start({auth, db, sdk}) {
    if (started) return;
    started = true;
    const helper = root.RomaPlanejamento;
    const production = root.RomaProducao;
    const service = helper.create({db, sdk});
    const state = {
      authenticated: false, canEdit: false, loading: false, rows: [], query: null,
      request: 0, tab: 'planejamento', week: null, weekBoard: null, weekLoading: false, weekDirty: true,
      weekRequest: 0, modal: null, modalRequest: 0, authRequest: 0,
      scheduleGroups: new Map(), drafts: new Map(), saveStates: new Map(), blockedKeys: new Set(),
      inlineSaving: false, navigating: false, savingKey: '', autoTimer: null, autoRunner: null,
      editRevision: 0, commitRevision: 0, dayTaloesView: null
    };
    const planningControls = ['filterRemessa','filterLinha','filterModelo','filterTipoCliente','filterTrilho','filterShowProgrammed','filterShowUnprogrammed','filterShowCompleteMounted','filterShowNotCompleteMounted','openPlanningCorteDatePicker','openPlanningEntregaDatePicker','openPlanningProgramadaDatePicker','searchPlanningButton','clearPlanningFilters'];
    const weekControls = ['weekDate','previousWeekButton','currentWeekButton','nextWeekButton','loadWeekButton','printSpecificDate'];

    function setControls() {
      planningControls.forEach(id => { $(id).disabled = !state.authenticated || state.loading || state.navigating; });
      weekControls.forEach(id => { $(id).disabled = !state.authenticated || state.weekLoading || state.navigating; });
      document.querySelectorAll('#trackCards button').forEach(button => { button.disabled = !state.authenticated || state.weekLoading || state.navigating; });
      $('tabPlanejamento').disabled = $('tabProgramacao').disabled = !state.authenticated || state.navigating;
      $('printWeekButton').disabled = !state.authenticated || state.weekLoading || !state.week || state.weekDirty || state.inlineSaving;
      ['printTodayButton','printTomorrowButton','printSpecificDateButton'].forEach(id => { $(id).disabled = !state.authenticated || state.weekLoading || state.inlineSaving; });
      $('planningTable').setAttribute('aria-busy', String(state.loading || state.inlineSaving));
      $('panelProgramacao').setAttribute('aria-busy', String(state.weekLoading));
      document.querySelectorAll('#planningTableBody button').forEach(button => {
        button.disabled = !state.authenticated || state.loading || state.navigating;
      });
      document.querySelectorAll('#planningTableBody [data-plan-field]').forEach(input => {
        const group = state.scheduleGroups.get(input.closest('tr').dataset.groupKey);
        input.disabled = !state.authenticated || !state.canEdit || state.loading || state.navigating || state.blockedKeys.has(input.closest('tr').dataset.groupKey) || !group?.eligible.length || !group.remessa;
      });
      updateSelection();
    }

    function setDefaultFilters() {
      const today = root.Roma.localISODate();
      $('filterRemessa').value = $('filterLinha').value = $('filterModelo').value = '';
      $('filterTipoCliente').value = 'todos';
      $('filterTrilho').value = 'all';
      $('filterShowProgrammed').checked = true;
      $('filterShowUnprogrammed').checked = true;
      $('filterShowCompleteMounted').checked = false;
      $('filterShowNotCompleteMounted').checked = true;
      $('filterDataCorteInicio').value = addDays(today, -60);
      $('filterDataCorteFim').value = addDays(today, 90);
      $('filterDataEntregaInicio').value = '';
      $('filterDataEntregaFim').value = '';
      $('filterDataProgramadaInicio').value = '';
      $('filterDataProgramadaFim').value = '';
      updatePlanningRangeLabels();
    }

    function planningFilters() {
      const cutStart = $('filterDataCorteInicio').value, cutEnd = $('filterDataCorteFim').value;
      const deliveryStart = $('filterDataEntregaInicio').value, deliveryEnd = $('filterDataEntregaFim').value;
      const useDeliveryQuery = !cutStart && !cutEnd && (deliveryStart || deliveryEnd);
      const primaryStart = useDeliveryQuery ? (deliveryStart || deliveryEnd) : (cutStart || cutEnd);
      const primaryEnd = useDeliveryQuery ? (deliveryEnd || deliveryStart) : (cutEnd || cutStart);
      return {
        remessa: text($('filterRemessa').value), dateField: useDeliveryQuery ? 'dataEntrega' : 'dataCorte',
        start: primaryStart, end: primaryEnd,
        cutStart, cutEnd, deliveryStart, deliveryEnd,
        plannedStart: $('filterDataProgramadaInicio').value, plannedEnd: $('filterDataProgramadaFim').value,
        trilho: $('filterTrilho').value,
        showProgrammed: $('filterShowProgrammed').checked, showUnprogrammed: $('filterShowUnprogrammed').checked,
        showCompleteMounted: $('filterShowCompleteMounted').checked, showNotCompleteMounted: $('filterShowNotCompleteMounted').checked,
        linha: normalized($('filterLinha').value), modelo: normalized($('filterModelo').value),
        tipo: normalized($('filterTipoCliente').value)
      };
    }

    function planningDateBR(iso) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
      return `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}`;
    }

    function updatePlanningRangeLabels() {
      const label = (start, end) => {
        if (!start && !end) return 'Selecionar data/período';
        if (start && (!end || start === end)) return planningDateBR(start);
        return `${start ? planningDateBR(start) : 'Início'} até ${end ? planningDateBR(end) : 'Fim'}`;
      };
      $('planningCorteRangeLabel').textContent = label($('filterDataCorteInicio').value, $('filterDataCorteFim').value);
      $('planningEntregaRangeLabel').textContent = label($('filterDataEntregaInicio').value, $('filterDataEntregaFim').value);
      $('planningProgramadaRangeLabel').textContent = label($('filterDataProgramadaInicio').value, $('filterDataProgramadaFim').value);
    }

    let planningDatePickerTarget = '';
    let planningDatePickerMonth = new Date();
    let planningDatePickerStart = null;
    let planningDatePickerEnd = null;

    function planningDateInputPair(target) {
      if (target === 'programada') return [$('filterDataProgramadaInicio'), $('filterDataProgramadaFim')];
      if (target === 'entrega') return [$('filterDataEntregaInicio'), $('filterDataEntregaFim')];
      return [$('filterDataCorteInicio'), $('filterDataCorteFim')];
    }

    function openPlanningDatePicker(target) {
      planningDatePickerTarget = target;
      const [startInput, endInput] = planningDateInputPair(target);
      planningDatePickerStart = startInput.value || null;
      planningDatePickerEnd = endInput.value || null;
      $('planningDatePickerTitle').textContent = target === 'programada' ? 'Selecionar Data Programada da Montagem' : target === 'entrega' ? 'Selecionar Data de Entrega' : 'Selecionar Data de Corte';
      const baseISO = planningDatePickerStart || planningDatePickerEnd || root.Roma.localISODate();
      const base = new Date(`${baseISO}T12:00:00`);
      planningDatePickerMonth = new Date(base.getFullYear(), base.getMonth(), 1);
      renderPlanningDatePicker();
      if (!$('planningDateRangeModal').open) $('planningDateRangeModal').showModal();
    }

    function localISO(date) {
      const y = date.getFullYear(), m = String(date.getMonth()+1).padStart(2,'0'), d = String(date.getDate()).padStart(2,'0');
      return `${y}-${m}-${d}`;
    }

    function renderPlanningDatePicker() {
      const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      $('planningDatePickerMonthTitle').textContent = `${months[planningDatePickerMonth.getMonth()]} ${planningDatePickerMonth.getFullYear()}`;
      const grid = $('planningDatePickerGrid');
      grid.innerHTML = '';
      const year = planningDatePickerMonth.getFullYear(), month = planningDatePickerMonth.getMonth();
      const first = new Date(year, month, 1);
      const gridStart = new Date(year, month, 1 - first.getDay());
      for (let index=0; index<42; index++) {
        const date = new Date(gridStart); date.setDate(gridStart.getDate()+index);
        const iso = localISO(date);
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'planning-date-picker-day'; button.textContent = String(date.getDate());
        if (date.getMonth() !== month) button.classList.add('out-month');
        const rangeEnd = planningDatePickerEnd || planningDatePickerStart;
        if (planningDatePickerStart && rangeEnd && iso >= planningDatePickerStart && iso <= rangeEnd) button.classList.add('in-range');
        if (planningDatePickerStart && iso === planningDatePickerStart) button.classList.add('range-start');
        if (rangeEnd && iso === rangeEnd) button.classList.add('range-end');
        button.addEventListener('click', () => {
          if (!planningDatePickerStart || (planningDatePickerStart && planningDatePickerEnd)) {
            planningDatePickerStart = iso; planningDatePickerEnd = null;
          } else if (iso < planningDatePickerStart) {
            planningDatePickerEnd = planningDatePickerStart; planningDatePickerStart = iso;
          } else planningDatePickerEnd = iso;
          renderPlanningDatePicker();
        });
        grid.appendChild(button);
      }
    }

    function applyPlanningDatePicker() {
      if (!planningDatePickerTarget) return;
      const [startInput, endInput] = planningDateInputPair(planningDatePickerTarget);
      if (planningDatePickerStart && !planningDatePickerEnd) planningDatePickerEnd = planningDatePickerStart;
      startInput.value = planningDatePickerStart || '';
      endInput.value = planningDatePickerEnd || '';
      updatePlanningRangeLabels();
      $('planningDateRangeModal').close();
    }

    const calendarDate = value => production.dateISO(value) || text(value);
    const shortDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : '—';
    const groupKey = row => JSON.stringify([text(row.numeroRemessa), text(row.linha), calendarDate(row.dataCorte), calendarDate(row.dataEntrega)]);

    function planOfGroup(records) {
      const plans = records.map(helper.getPlan), planned = plans.filter(plan => plan.planned);
      const tracks = new Set(planned.map(plan => plan.track)), dates = new Set(planned.map(plan => plan.date));
      const allPlanned = planned.length === plans.length && plans.length > 0;
      return {
        track: allPlanned && tracks.size === 1 ? String([...tracks][0]) : '',
        date: allPlanned && dates.size === 1 ? [...dates][0] : '',
        status: !planned.length ? 'none' : !allPlanned ? 'partial' : tracks.size === 1 && dates.size === 1 ? 'single' : 'split'
      };
    }

    function scheduleGroups() {
      const groups = new Map();
      for (const row of state.rows) {
        const key = groupKey(row);
        if (!groups.has(key)) groups.set(key, {key, remessa:text(row.numeroRemessa), line:text(row.linha), cut:calendarDate(row.dataCorte), delivery:calendarDate(row.dataEntrega), all:[]});
        groups.get(key).all.push(row);
      }
      for (const group of groups.values()) {
        group.eligible = group.all.filter(row => !helper.isMounted(row));
        group.records = group.all;
        group.plan = planOfGroup(group.eligible.length ? group.eligible : group.all);
      }
      return [...groups.values()].sort((a, b) => a.cut.localeCompare(b.cut)
        || a.line.localeCompare(b.line, 'pt-BR', {numeric:true}) || a.remessa.localeCompare(b.remessa, 'pt-BR', {numeric:true})
        || a.delivery.localeCompare(b.delivery));
    }

    function stageCells(records, stage) {
      if (stage === 'distribuicao') {
        // Disponibilidade física é a interseção dos recebimentos aplicáveis
        // de cada talão. Saídas de ateliê, sozinhas, não significam chegada.
        const available = records.filter(row => !helper.isMounted(row)
          && ['costura','palmilha','sola'].every(sector => !root.Roma.stageApplicable(row, sector) || root.Roma.factoryReceived(row, sector)));
        return `<td data-stage="factory" data-measure="pairs">${number(sumPairs(available))}</td><td class="schedule-stage-end" data-stage="factory" data-measure="taloes">${number(available.length)}</td>`;
      }
      const result = records.reduce((total, row) => production.addToStage(total, {...row, pares:pairs(row)}, stage), production.emptyStage());
      const end = 'schedule-stage-end';
      if (!result.aplicaveis) return `<td colspan="2" class="schedule-na ${end}" data-stage="${stage}" title="Este componente não faz parte dos modelos deste grupo">N/A</td>`;
      if (result.allDone) return `<td colspan="2" class="schedule-done ${end}" data-stage="${stage}" title="${result.maxDate ? `Concluído em ${dateLabel(result.maxDate)}` : 'Etapa concluída'}">✓ ${result.maxDate ? shortDate(result.maxDate) : 'OK'}</td>`;
      return `<td data-stage="${stage}" data-measure="pairs">${number(result.paresFaltando)}</td><td class="${end}" data-stage="${stage}" data-measure="taloes">${number(result.taloesFaltando)}</td>`;
    }

    function clientClass(records) {
      const types = [...new Set(records.map(row => normalized(row.tipoCliente)))];
      if (types.length !== 1) return 'mercado-interno-row';
      return ({exportacao:'exportacao-row','cliente especial':'cliente-especial-row','mercado interno':'mercado-interno-row',estoque:'estoque-row',amostra:'amostra-row'})[types[0]] || 'mercado-interno-row';
    }

    function renderPlanning() {
      const filter = state.query || {};
      const allGroups = scheduleGroups();
      state.scheduleGroups = new Map(allGroups.map(group => [group.key, group]));
      // Modelo/tipo selecionam a linha completa: quantidade exibida e alcance
      // da edição continuam iguais, mesmo com vários modelos na mesma remessa.
      const groups = allGroups.filter(group => group.records.length
        && (!filter.linha || normalized(group.line) === filter.linha)
        && (!filter.modelo || group.records.some(row => normalized(helper.modelLabel(row)).includes(filter.modelo)))
        && (!filter.tipo || filter.tipo === 'todos' || group.records.some(row => normalized(row.tipoCliente) === filter.tipo))
        && (filter.remessa || filter.dateField !== 'dataEntrega' || ((!filter.cutStart || group.cut >= filter.cutStart) && (!filter.cutEnd || group.cut <= filter.cutEnd)))
        && ((!filter.deliveryStart && !filter.deliveryEnd) || ((!filter.deliveryStart || group.delivery >= filter.deliveryStart) && (!filter.deliveryEnd || group.delivery <= filter.deliveryEnd)))
        && (!filter.trilho || filter.trilho === 'all' || group.records.some(row => String(helper.getPlan(row).track || '') === String(filter.trilho)))
        && (() => {
          const isProgrammed = group.records.some(row => helper.getPlan(row).planned);
          return (isProgrammed && filter.showProgrammed) || (!isProgrammed && filter.showUnprogrammed);
        })()
        && (() => {
          const completeMounted = group.all.length > 0 && group.all.every(row => helper.isMounted(row));
          return (completeMounted && filter.showCompleteMounted) || (!completeMounted && filter.showNotCompleteMounted);
        })()
        && ((!filter.plannedStart && !filter.plannedEnd) || group.records.some(row => {
          const plan = helper.getPlan(row);
          return plan.planned && (!filter.plannedStart || plan.date >= filter.plannedStart) && (!filter.plannedEnd || plan.date <= filter.plannedEnd);
        })));
      const pending = groups.flatMap(group => group.eligible);
      const remessas = new Set(groups.map(group => group.remessa));
      $('planRemessasCount').textContent = number(remessas.size);
      $('planPairsCount').textContent = number(sumPairs(pending));
      $('planPlannedPairs').textContent = number(sumPairs(pending.filter(row => helper.getPlan(row).planned)));
      $('planUnplannedPairs').textContent = number(sumPairs(pending.filter(row => !helper.getPlan(row).planned)));
      $('planningTableBody').innerHTML = groups.length ? groups.map(group => {
        const draft = state.drafts.get(group.key), plan = draft || group.plan, remessa = escape(group.remessa);
        const hint = group.plan.status === 'partial' ? 'Parcial' : group.plan.status === 'split' ? 'Dividido' : '';
        const models = [...new Set(group.records.map(helper.modelLabel))].join(', ');
        const scope = `Remessa ${group.remessa}, linha ${group.line}, corte ${dateLabel(group.cut)}, entrega ${dateLabel(group.delivery)}. ${group.eligible.length} talões disponíveis. Modelos: ${models}.`;
        return `<tr class="${clientClass(group.records)}${draft ? ' schedule-dirty' : ''}" data-group-key="${escape(group.key)}" data-remessa="${remessa}" data-linha="${escape(group.line)}">
          <td title="${escape(models)}">${escape(group.line || '—')}</td>
          <td>${group.remessa ? `<button type="button" class="schedule-remessa-link" data-action="taloes" data-remessa="${remessa}" title="Consultar e planejar talões da remessa ${remessa}">${remessa}</button>` : 'Sem remessa'}</td>
          <td>${number(sumPairs(group.records))}</td><td>${number(group.records.length)}</td>
          <td title="${escape(dateLabel(group.cut))}">${shortDate(group.cut)}</td><td title="${escape(dateLabel(group.delivery))}">${shortDate(group.delivery)}</td>
          ${production.STAGES.map(stage => stageCells(group.records, stage)).join('')}
          <td><select class="schedule-track-input" data-plan-field="track" aria-label="Trilho da remessa ${remessa}, linha ${escape(group.line)}" title="${escape(scope)}"><option value="" disabled${!plan.track ? ' selected' : ''}>${hint || '—'}</option>${helper.TRACKS.map(track => `<option value="${track.value}"${String(plan.track) === String(track.value) ? ' selected' : ''}>${track.value}</option>`).join('')}</select></td>
          <td><input class="schedule-date-input" data-plan-field="date" type="date" value="${escape(plan.date)}" aria-label="Previsão de montagem da remessa ${remessa}, linha ${escape(group.line)}" title="${escape(scope)}"><small class="schedule-plan-state" aria-live="polite"></small></td></tr>`;
      }).join('') : '<tr><td colspan="22" class="empty-state">Nenhuma remessa encontrada com esses filtros. Ajuste o período ou procure pelo número exato da remessa.</td></tr>';
      if (state.query) {
        const scope = filter.remessa ? `Remessa ${filter.remessa}; o período de corte não limita esta consulta.` : filter.dateField === 'dataEntrega' ? `Entrega de ${dateLabel(filter.start)} a ${dateLabel(filter.end)}.` : `Corte de ${dateLabel(filter.start)} a ${dateLabel(filter.end)}.`;
        const deliveryScope = filter.dateField === 'dataEntrega' ? '' : filter.deliveryStart || filter.deliveryEnd ? ` Entrega de ${dateLabel(filter.deliveryStart || filter.deliveryEnd)} a ${dateLabel(filter.deliveryEnd || filter.deliveryStart)}.` : '';
        const plannedScope = filter.plannedStart || filter.plannedEnd ? ` Programação de montagem de ${dateLabel(filter.plannedStart || filter.plannedEnd)} a ${dateLabel(filter.plannedEnd || filter.plannedStart)}.` : '';
        const trackScope = filter.trilho && filter.trilho !== 'all' ? ` Trilho ${filter.trilho}.` : '';
        $('planningResultNote').textContent = `${number(remessas.size)} remessa(s) em ${number(groups.length)} linha(s). ${scope}${deliveryScope}${trackScope}${plannedScope} Cada linha reúne remessa, linha, corte e entrega; Trilho e Prev. Mont. valem para seus talões ainda não montados.`;
      }
      updateInlineFeedback();
      setControls();
    }

    const AUTOSAVE_DELAY = 600;

    function validInlineTarget(draft) {
      if (!draft || ![1,2,3].includes(Number(draft.track)) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || draft.date.startsWith('0000-')) return false;
      const date = new Date(`${draft.date}T12:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === draft.date;
    }

    function updateInlineFeedback() {
      document.querySelectorAll('#planningTableBody tr[data-group-key]').forEach(row => {
        const key = row.dataset.groupKey, draft = state.drafts.get(key), saved = state.saveStates.get(key);
        const group = state.scheduleGroups.get(key);
        row.classList.toggle('schedule-dirty', !!draft);
        const status = row.querySelector('.schedule-plan-state');
        if (!status) return;
        if (saved?.status === 'error') status.textContent = saved.detail;
        else if (state.savingKey === key) status.textContent = 'Salvando…';
        else if (draft) status.textContent = validInlineTarget(draft) ? 'Aguardando salvamento…' : 'Complete trilho e data';
        else if (saved?.status === 'saved') status.textContent = 'Salvo';
        else status.textContent = group?.plan.status === 'partial' ? 'Parcial' : group?.plan.status === 'split' ? 'Dividido' : '';
        status.dataset.status = saved?.status === 'error' ? 'error' : draft || state.savingKey === key ? 'pending' : saved?.status || '';
      });
      const errors = [...state.saveStates.values()].filter(item => item.status === 'error');
      const valid = [...state.drafts.values()].filter(validInlineTarget).length;
      const incomplete = state.drafts.size - valid;
      if (errors.length) message('inlinePlanningMessage', errors.map(item => item.detail).join(' '), 'error');
      else if (state.inlineSaving) message('inlinePlanningMessage', 'Salvando automaticamente. Você pode continuar editando as remessas.');
      else if (valid) message('inlinePlanningMessage', `${number(valid)} linha(s) aguardando salvamento automático.`);
      else if (incomplete) message('inlinePlanningMessage', `Complete Trilho e Prev. Mont. em ${number(incomplete)} linha(s) para salvar automaticamente. O planejamento anterior permanece salvo até os dois campos estarem preenchidos.`, 'warning');
      else message('inlinePlanningMessage', state.saveStates.size ? 'Alterações salvas automaticamente.' : '', 'success');
    }

    // Atualiza somente as células necessárias. Um commit não recria a tabela
    // nem substitui o campo em que o operador está digitando.
    function syncInlineRows() {
      state.scheduleGroups = new Map(scheduleGroups().map(group => [group.key, group]));
      const visible = [];
      document.querySelectorAll('#planningTableBody tr[data-group-key]').forEach(row => {
        const key = row.dataset.groupKey, group = state.scheduleGroups.get(key);
        if (!group) return;
        visible.push(group);
        const trackInput = row.querySelector('[data-plan-field="track"]');
        const dateInput = row.querySelector('[data-plan-field="date"]');
        if (!state.drafts.has(key)) {
          trackInput.value = group.plan.track;
          dateInput.value = group.plan.date;
          trackInput.querySelector('option[value=""]').textContent = group.plan.status === 'partial' ? 'Parcial' : group.plan.status === 'split' ? 'Dividido' : '—';
        }
        row.children[2].textContent = number(sumPairs(group.records));
        row.children[3].textContent = number(group.records.length);
        const planCell = trackInput.closest('td');
        row.querySelectorAll('td[data-stage]').forEach(cell => cell.remove());
        planCell.insertAdjacentHTML('beforebegin', production.STAGES.map(stage => stageCells(group.records, stage)).join(''));
      });
      const pending = visible.flatMap(group => group.eligible);
      $('planRemessasCount').textContent = number(new Set(visible.map(group => group.remessa)).size);
      $('planPairsCount').textContent = number(sumPairs(pending));
      $('planPlannedPairs').textContent = number(sumPairs(pending.filter(row => helper.getPlan(row).planned)));
      $('planUnplannedPairs').textContent = number(sumPairs(pending.filter(row => !helper.getPlan(row).planned)));
      updateInlineFeedback();
      setControls();
    }

    function clearAutoTimer() {
      if (state.autoTimer !== null) root.clearTimeout(state.autoTimer);
      state.autoTimer = null;
    }

    function armAutosave() {
      clearAutoTimer();
      if (!state.authenticated || !state.canEdit || state.autoRunner || state.navigating) return;
      const pending = [...state.drafts.values()].filter(draft => validInlineTarget(draft) && Number.isFinite(draft.dueAt));
      if (!pending.length) return;
      const authRequest = state.authRequest;
      const next = Math.min(...pending.map(draft => draft.dueAt));
      state.autoTimer = root.setTimeout(() => {
        state.autoTimer = null;
        if (authRequest === state.authRequest) void runAutosaves();
      }, Math.max(0, next - Date.now()));
    }

    function changeInlinePlan(event) {
      const input = event.target;
      if (!input.matches('[data-plan-field]') || !state.authenticated || !state.canEdit || state.loading || state.navigating) return;
      const row = input.closest('tr'), group = state.scheduleGroups.get(row.dataset.groupKey);
      if (!group?.eligible.length || !group.remessa || state.blockedKeys.has(group.key)) return;
      const track = row.querySelector('[data-plan-field="track"]').value;
      const date = row.querySelector('[data-plan-field="date"]').value;
      const previous = state.drafts.get(group.key);
      // A volta ao valor anterior durante um commit também é uma nova intenção.
      // Somente a revisão que iniciou o commit pode ser removida ao concluí-lo.
      if (track === group.plan.track && date === group.plan.date && state.savingKey !== group.key) {
        state.drafts.delete(group.key);
      } else {
        const changed = !previous || track !== previous.track || date !== previous.date;
        const draft = {key:group.key, remessa:group.remessa, line:group.line,
          records:previous?.records || group.eligible.map(record => ({...record})), track, date,
          revision:changed ? ++state.editRevision : previous.revision,
          dueAt:changed ? Infinity : previous.dueAt};
        if (event.type === 'change' && validInlineTarget(draft)) draft.dueAt = Date.now() + AUTOSAVE_DELAY;
        if (!validInlineTarget(draft)) draft.dueAt = Infinity;
        state.drafts.set(group.key, draft);
        state.saveStates.delete(group.key);
      }
      updateInlineFeedback();
      setControls();
      armAutosave();
    }

    async function saveInlineDraft(job, authRequest) {
      const currentSession = () => authRequest === state.authRequest && state.authenticated;
      if (!currentSession()) return;
      state.inlineSaving = true;
      state.savingKey = job.key;
      updateInlineFeedback();
      setControls();
      let result = {savedRecords:[], unchangedIds:[], pendingIds:job.records.map(row => row.id)};
      let failure = null;
      try {
        root.Roma.requireWrite('planejamento');
        const fresh = await service.loadRemessa(job.remessa);
        if (!currentSession()) return;
        const current = fresh.filter(row => groupKey(row) === job.key && !helper.isMounted(row));
        const ids = new Set(current.map(row => row.id));
        if (ids.size !== job.records.length || job.records.some(row => !ids.has(row.id))) {
          throw new Error('Os talões desta linha mudaram desde a consulta. Confira a composição, as datas e a montagem antes de planejar novamente.');
        }
        // Releitura confere a composição; a transação ainda recebe os snapshots
        // originais. Dados externos nunca renovam silenciosamente a versão CAS.
        const allPending = fresh.filter(row => !helper.isMounted(row));
        result = await service.savePlan({records:job.records, track:Number(job.track), date:job.date,
          origin:job.records.length === allPending.length ? 'remessa' : 'talao'});
        if (!currentSession()) return;
        if (!result.complete) failure = result.error || new Error('Não foi possível concluir todos os talões.');
      } catch (error) {
        if (!currentSession()) return;
        failure = error;
      }
      if (!currentSession()) return;
      replaceKnownRows(result.savedRecords);
      if (result.savedRecords.length) {
        state.weekDirty = true;
        ++state.commitRevision;
      }
      const latest = state.drafts.get(job.key);
      if (!failure) {
        if (latest?.revision === job.revision) state.drafts.delete(job.key);
        else if (latest) {
          // Apenas os próprios commits confirmados podem atualizar a base de
          // uma edição feita enquanto a anterior estava em voo.
          const ownCommits = new Map(result.savedRecords.map(row => [row.id, row]));
          latest.records = latest.records.map(row => ownCommits.get(row.id) || row);
        }
        state.saveStates.set(job.key, {status:'saved', remessa:job.remessa});
      } else {
        const target = `Trilho ${job.track}, ${dateLabel(job.date)}`;
        const newer = latest && latest.revision !== job.revision
          ? ` Última edição pendente: Trilho ${latest.track || 'não definido'}, ${dateLabel(latest.date)}.` : '';
        const detail = `Remessa ${job.remessa}, linha ${job.line}: gravação não concluída. ${number(result.savedRecords.length)} talão(ões) salvos, ${number(result.unchangedIds.length)} já estavam iguais e ${number(result.pendingIds.length)} sem conclusão. Alvo: ${target}.${newer} ${errorText(failure)} Abra a remessa ou use Buscar remessas para revisar antes de tentar novamente.`;
        state.drafts.delete(job.key);
        state.blockedKeys.add(job.key);
        state.saveStates.set(job.key, {status:'error', remessa:job.remessa, detail});
        try {
          const refreshed = await service.loadRemessa(job.remessa);
          if (!currentSession()) return;
          reconcileRemessa(job.remessa, refreshed);
        } catch (_) {
          if (!currentSession()) return;
          state.saveStates.get(job.key).detail += ' Não foi possível atualizar os dados; a linha permanece bloqueada até nova consulta.';
        }
      }
      if (!currentSession()) return;
      state.inlineSaving = false;
      state.savingKey = '';
      syncInlineRows();
    }

    function runAutosaves() {
      if (state.autoRunner) return state.autoRunner.promise;
      clearAutoTimer();
      const runner = {epoch:state.authRequest, promise:null};
      state.autoRunner = runner;
      runner.promise = (async () => {
        try {
          while (runner.epoch === state.authRequest && state.authenticated && state.canEdit) {
            const next = [...state.drafts.values()].filter(draft => validInlineTarget(draft) && draft.dueAt <= Date.now())
              .sort((a, b) => a.dueAt - b.dueAt || a.revision - b.revision)[0];
            if (!next) break;
            await saveInlineDraft({...next, records:next.records.map(row => ({...row}))}, runner.epoch);
          }
        } finally {
          if (state.autoRunner === runner && runner.epoch === state.authRequest) {
            state.autoRunner = null;
            state.inlineSaving = false;
            state.savingKey = '';
            updateInlineFeedback();
            setControls();
            armAutosave();
          }
        }
      })();
      return runner.promise;
    }

    // Trocas de contexto aguardam os planos completos. Só rascunhos incompletos
    // precisam de decisão do operador; apagar uma data não limpa o banco.
    async function prepareNavigation(discardScope = null) {
      if (!state.authenticated || state.navigating) return false;
      const authRequest = state.authRequest;
      state.navigating = true;
      clearAutoTimer();
      setControls();
      try {
        for (const draft of state.drafts.values()) if (validInlineTarget(draft)) draft.dueAt = 0;
        while (state.autoRunner || [...state.drafts.values()].some(validInlineTarget)) {
          await runAutosaves();
          if (authRequest !== state.authRequest || !state.authenticated) return false;
        }
        const incomplete = [...state.drafts.values()].filter(draft => discardScope === 'all' || draft.remessa === discardScope);
        if (incomplete.length) {
          if (!root.confirm(`Existem ${incomplete.length} linha(s) com trilho ou data incompletos. Descartar somente essas edições para continuar? Os planejamentos já salvos serão mantidos.`)) return false;
          incomplete.forEach(draft => state.drafts.delete(draft.key));
          syncInlineRows();
        }
        return true;
      } finally {
        if (authRequest === state.authRequest) {
          state.navigating = false;
          updateInlineFeedback();
          setControls();
          armAutosave();
        }
      }
    }

    async function loadPlanning({resetFilters = false} = {}) {
      if (!state.authenticated || state.loading || !await prepareNavigation('all')) return;
      if (resetFilters) setDefaultFilters();
      const request = ++state.request;
      const filter = planningFilters();
      state.loading = true;
      message('planningPageMessage', 'Consultando as remessas no banco...');
      setControls();
      try {
        const rows = await service.loadPlanning(filter);
        if (request !== state.request || !state.authenticated) return;
        state.rows = rows;
        state.query = filter;
        state.blockedKeys.clear();
        state.saveStates.clear();
        renderPlanning();
        message('planningPageMessage', '');
      } catch (error) {
        if (request !== state.request) return;
        state.rows = [];
        state.query = null;
        renderPlanning();
        $('planningTableBody').innerHTML = '<tr><td colspan="22" class="empty-state">A consulta não foi concluída. Confira a mensagem acima e busque novamente.</td></tr>';
        $('planningResultNote').textContent = '';
        message('planningPageMessage', errorText(error), 'error');
      } finally {
        if (request === state.request) { state.loading = false; setControls(); }
      }
    }

    function weekDateLabel(iso) {
      const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
      return `${iso.slice(8, 10)}/${months[Number(iso.slice(5, 7)) - 1]}`;
    }

    function trackColorName(track) {
      return ({1:'azul',2:'verde',3:'roxo'})[Number(track)] || 'azul';
    }

    function renderTrackDayCard(track, day, descriptor, options = {}) {
      const trackName = `Trilho ${String(track.track).padStart(2, '0')}`;
      const showPrint = options.showPrint !== false;
      const remessas = day?.remessas || [];
      const totalPairs = Number(day?.pairs || 0);
      const remainingPairs = Number(day?.remainingPairs || 0);
      return `<article class="day-track-card track-${track.track}" data-track="${track.track}" data-date="${escape(day.date)}" aria-label="${escape(trackName)}, ${escape(descriptor.label)}, ${dateLabel(day.date)}">
        <header class="day-track-card-head">
          <div><h3>${escape(trackName)}</h3><p><strong>${weekDateLabel(day.date)}</strong> · ${escape(descriptor.label)}</p></div>
          ${showPrint ? `<button type="button" class="day-track-print" data-print-track="${track.track}" data-print-date="${day.date}" title="Imprimir somente ${escape(trackName)} deste dia">Imprimir</button>` : ''}
        </header>
        <div class="day-track-columns"><span>Remessa</span><span>Pares</span><span>Falta mont.</span></div>
        <ul class="day-track-list">${remessas.length ? remessas.map(remessa => `<li><button type="button" class="week-remessa-link" data-week-remessa="${escape(remessa.remessa)}" data-track="${track.track}" data-date="${day.date}" aria-label="Detalhar remessa ${escape(remessa.remessa || 'sem número')}, ${number(remessa.pairs)} pares, ${number(remessa.remainingPairs)} faltando montar, ${escape(trackName)}, ${escape(descriptor.label)}, ${dateLabel(day.date)}">${escape(remessa.remessa || 'Sem remessa')}</button><strong>${number(remessa.pairs)}</strong><strong class="remessa-remaining">${number(remessa.remainingPairs)}</strong></li>`).join('') : '<li class="day-track-empty">Sem programação</li>'}</ul>
        <footer class="day-track-totals"><div class="day-track-total"><span>Total de pares</span><strong>${number(totalPairs)}</strong></div><div class="day-track-total secondary"><span>Falta montar</span><strong>${number(remainingPairs)}</strong></div></footer>
      </article>`;
    }

    function renderWeek(result) {
      const board = helper.weekCalendar(result.summary, result.start);
      state.weekBoard = board;
      $('weekRangeLabel').textContent = `Semana de ${dateLabel(board.start)} a ${dateLabel(board.end)}`;
      [['weekTotalPairs','pairs'],['weekRemainingPairs','remainingPairs'],['weekReadyPairs','readyPairs'],['weekMountedPairs','mountedPairs']].forEach(([id, key]) => { $(id).textContent = number(board.totals[key]); });
      message('weekOutsideMessage', board.weekendTotals.talaoCount ? `Fim de semana: ${number(board.weekendTotals.talaoCount)} talão(ões) e ${number(board.weekendTotals.pairs)} pares programados fora deste quadro de segunda a sexta. Os registros podem ser consultados na aba Planejamento.` : '');
      $('trackCards').innerHTML = board.tracks.map(track => {
        const trackName = `Trilho ${String(track.track).padStart(2, '0')}`;
        const totalPairs = Number(track.pairs || 0);
        const mountedPairs = Number(track.mountedPairs || 0);
        const remainingPairs = Number(track.remainingPairs || 0);
        const programmedDays = (track.days || []).filter(day => Number(day.pairs || 0) > 0).length;
        const averagePairs = programmedDays ? Math.round(totalPairs / programmedDays) : 0;
        return `<article class="week-board-track" data-track="${track.track}" aria-label="Programação do ${escape(trackName)}">
          <header class="week-board-head">
            <button type="button" class="week-board-nav" data-week-offset="-7" aria-label="Semana anterior, todos os trilhos" title="Consultar a semana anterior em todos os trilhos">‹ Anterior</button>
            <div class="week-board-title">
              <h3>${escape(trackName)}</h3>
              <div class="week-board-metrics" aria-label="Resumo do ${escape(trackName)}">
                <span><small>Total de pares</small><strong>${number(totalPairs)}</strong></span>
                <span><small>Já montado</small><strong>${number(mountedPairs)}</strong></span>
                <span><small>Falta montar</small><strong>${number(remainingPairs)}</strong></span>
                <span class="metric-average"><small>Média por dia</small><strong>${number(averagePairs)}</strong><em>${number(programmedDays)} ${programmedDays === 1 ? 'dia' : 'dias'}</em></span>
              </div>
            </div>
            <div class="week-board-head-actions">
              <button type="button" class="week-track-print" data-print-week-track="${track.track}" title="Imprimir a programação semanal do ${escape(trackName)}">Imprimir trilho</button>
              <button type="button" class="week-board-nav" data-week-offset="7" aria-label="Próxima semana, todos os trilhos" title="Consultar a próxima semana em todos os trilhos">Próxima ›</button>
            </div>
          </header>
          <div class="week-board-scroll" tabindex="0" role="region" aria-label="Dias e remessas do ${escape(trackName)}. Role horizontalmente para ver os demais dias.">
            <div class="week-board-days" style="--week-days:${board.days.length}">
            ${track.days.map((day, index) => {
              const descriptor = board.days[index];
              return `<section class="week-day${descriptor.weekend ? ' week-day-weekend' : ''}" data-date="${day.date}" aria-label="${escape(descriptor.label)}, ${dateLabel(day.date)}">
                <header class="week-day-head"><div class="week-day-head-copy"><time datetime="${day.date}" title="${dateLabel(day.date)}">${weekDateLabel(day.date)}</time><h4>${escape(descriptor.label)}</h4></div><button type="button" class="week-day-taloes-button" data-day-taloes-track="${track.track}" data-day-taloes-date="${day.date}" title="Ver os talões ainda não montados de ${escape(descriptor.label)}">Talões</button></header>
                <div class="week-day-columns"><span>Remessa</span><span>Pares</span><span>Falta mont.</span></div>
                <ul class="week-day-list">${day.remessas.length ? day.remessas.map(remessa => `<li><button type="button" class="week-remessa-link" data-week-remessa="${escape(remessa.remessa)}" data-track="${track.track}" data-date="${day.date}" aria-label="Detalhar remessa ${escape(remessa.remessa || 'sem número')}, ${number(remessa.pairs)} pares, ${number(remessa.remainingPairs)} faltando montar, ${escape(trackName)}, ${escape(descriptor.label)}, ${dateLabel(day.date)}">${escape(remessa.remessa || 'Sem remessa')}</button><span>${number(remessa.pairs)}</span><span class="remessa-remaining">${number(remessa.remainingPairs)}</span></li>`).join('') : '<li class="week-day-empty">Sem programação</li>'}</ul>
                <footer class="week-day-totals"><div class="week-day-total"><span>Total de pares</span><strong>${number(day.pairs)}</strong></div><div class="week-day-total secondary"><span>Falta montar</span><strong>${number(day.remainingPairs)}</strong></div></footer>
              </section>`;
            }).join('')}
            </div>
          </div>
        </article>`;
      }).join('');
    }

    function plannedDayRecords(trackNumber, date) {
      const track = Number(trackNumber);
      return (state.week?.records || []).filter(row => {
        const plan = helper.getPlan(row);
        return plan.planned && plan.track === track && plan.date === date && !helper.isMounted(row);
      });
    }

    function talaoFactoryStatus(row) {
      const checks = typeof root.Roma?.factoryChecks === 'function' ? root.Roma.factoryChecks(row) : [];
      const pending = checks.filter(check => check.applicable && !check.ready).map(check => check.label);
      return {complete: pending.length === 0, pending};
    }

    function talaoLabel(row) {
      return text(row.numeroTalaoSequencial ?? row.numeroTalao) || text(row.codigoBarrasIdentificador || row.codigoBarras) || '—';
    }

    function atelierNameForSector(row, sector) {
      const fields = {
        costura: ['idAtelieResponsavel', 'atelieCosturaNome', 'nomeAtelieCostura'],
        sola: ['idAtelieSolaResponsavel', 'atelieSolaNome', 'nomeAtelieSola'],
        palmilha: ['idAteliePalmilhaResponsavel', 'ateliePalmilhaNome', 'nomeAteliePalmilha']
      }[sector] || [];
      for (const field of fields) {
        const value = text(row?.[field]);
        if (value) return value;
      }
      return 'Sem ateliê';
    }

    function pendingAtelierSummary(row) {
      const status = talaoFactoryStatus(row);
      if (status.complete) return 'Fábrica';
      const labels = [];
      if (status.pending.includes('Costura')) labels.push(`Costura: ${atelierNameForSector(row, 'costura')}`);
      if (status.pending.includes('Palmilha')) labels.push(`Palmilha: ${atelierNameForSector(row, 'palmilha')}`);
      if (status.pending.includes('Sola')) labels.push(`Sola: ${atelierNameForSector(row, 'sola')}`);
      return labels.join(' · ') || '—';
    }

    function dayTaloesGroups(records) {
      const groups = new Map();
      records.forEach(row => {
        const remessa = text(row.numeroRemessa) || 'Sem remessa';
        if (!groups.has(remessa)) groups.set(remessa, []);
        groups.get(remessa).push(row);
      });
      return [...groups.entries()].sort((a,b) => a[0].localeCompare(b[0], 'pt-BR', {numeric:true}));
    }

    function dayTaloesTableHTML(remessa, records, forPrint = false) {
      const totalPairs = sumPairs(records);
      const completeCount = records.filter(row => talaoFactoryStatus(row).complete).length;
      const rows = records.slice().sort((a,b) => talaoLabel(a).localeCompare(talaoLabel(b), 'pt-BR', {numeric:true})).map(row => {
        const status = talaoFactoryStatus(row);
        const statusText = status.complete ? 'Completo' : `Falta ${status.pending.join(' + ')}`;
        return `<tr><td>${escape(talaoLabel(row))}</td><td>${escape(row.linha || '—')}</td><td>${escape(helper.modelLabel(row) || '—')}</td><td class="cell-number">${number(pairs(row))}</td><td>${escape(pendingAtelierSummary(row))}</td><td><span class="talao-ready-status ${status.complete ? 'complete' : 'pending'}">${escape(statusText)}</span></td></tr>`;
      }).join('');
      return `<section class="day-talao-group${forPrint ? ' print-day-talao-group' : ''}"><header><div><h3>Remessa ${escape(remessa)}</h3><p>${number(records.length)} talão(ões) · ${number(totalPairs)} pares</p></div><span>${number(completeCount)} completos</span></header><div class="day-talao-table-wrap"><table class="week-table day-talao-table"><thead><tr><th>Talão</th><th>Linha</th><th>Modelo</th><th class="cell-number">Pares</th><th>Ateliê(s)</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }

    function openDayTaloes(trackNumber, date) {
      if (!state.authenticated || state.weekLoading || !state.weekBoard) return;
      const track = Number(trackNumber);
      const descriptor = state.weekBoard.days.find(item => item.date === date) || {label: 'Dia'};
      const records = plannedDayRecords(track, date);
      const groups = dayTaloesGroups(records);
      state.dayTaloesView = {track, date, descriptor, records};
      $('dayTaloesTitle').textContent = `Talões · Trilho ${String(track).padStart(2,'0')}`;
      $('dayTaloesSubtitle').textContent = `${descriptor.label}, ${dateLabel(date)} · somente talões ainda não montados`;
      const complete = records.filter(row => talaoFactoryStatus(row).complete).length;
      $('dayTaloesSummary').innerHTML = `<span><small>Remessas</small><strong>${number(groups.length)}</strong></span><span><small>Talões</small><strong>${number(records.length)}</strong></span><span><small>Pares</small><strong>${number(sumPairs(records))}</strong></span><span><small>Completos</small><strong>${number(complete)}</strong></span><span><small>Com pendência</small><strong>${number(records.length-complete)}</strong></span>`;
      $('dayTaloesGroups').innerHTML = groups.length ? groups.map(([remessa, rows]) => dayTaloesTableHTML(remessa, rows)).join('') : '<p class="empty-state">Não há talões pendentes de montagem neste dia e trilho.</p>';
      $('printDayTaloesButton').disabled = !records.length;
      if (!$('dayTaloesModal').open) $('dayTaloesModal').showModal();
    }

    function closeDayTaloes() {
      state.dayTaloesView = null;
      if ($('dayTaloesModal').open) $('dayTaloesModal').close();
    }

    function printDayTaloesReport() {
      const view = state.dayTaloesView;
      if (!view?.records?.length) return;
      const groups = dayTaloesGroups(view.records);
      const complete = view.records.filter(row => talaoFactoryStatus(row).complete).length;
      const body = groups.map(([remessa, rows]) => dayTaloesTableHTML(remessa, rows, true)).join('');
      const html = `<div class="print-day-taloes-page"><header class="print-day-taloes-head"><strong>Calçados Roma</strong><h1>Talões para montagem · Trilho ${String(view.track).padStart(2,'0')}</h1><p>${escape(view.descriptor.label)}, ${dateLabel(view.date)} · ${number(view.records.length)} talões · ${number(sumPairs(view.records))} pares · ${number(complete)} completos</p></header>${body}</div>`;
      beginPrint(html, 'print-day-taloes');
    }

    function sectorWhatsRecords(sector) {
      const records = state.dayTaloesView?.records || [];
      // Montagem: listar todos os talões ainda não montados do dia/trilho, mesmo incompletos.
      if (sector === 'montagem') return records;
      // Costura/Sola/Palmilha: talões aplicáveis cujo trabalho do setor ainda não foi finalizado.
      return records.filter(row => {
        if (typeof root.Roma?.stageApplicable !== 'function' || typeof root.Roma?.stageComplete !== 'function') return false;
        return root.Roma.stageApplicable(row, sector) && !root.Roma.stageComplete(row, sector);
      });
    }

    function sectorWhatsLabel(sector) {
      return ({costura:'Costura', sola:'Sola', palmilha:'Palmilha', montagem:'Montagem'})[sector] || sector;
    }

    function buildSectorWhatsMessage(sector) {
      const view = state.dayTaloesView;
      if (!view) return {message:'', records:[]};
      const records = sectorWhatsRecords(sector);
      const label = sectorWhatsLabel(sector);
      const groups = dayTaloesGroups(records);
      const lines = [
        `*PROGRAMAÇÃO ${label.toUpperCase()}*`,
        `${view.descriptor.label}, ${dateLabel(view.date)} · Trilho ${String(view.track).padStart(2,'0')}`,
        ''
      ];
      if (!records.length) {
        lines.push(`Nenhum talão aberto para ${label}.`);
        return {message:lines.join('\n'), records};
      }
      groups.forEach(([remessa, rows]) => {
        lines.push(`*Remessa ${remessa}*`);
        const sorted = rows.slice().sort((a,b) => talaoLabel(a).localeCompare(talaoLabel(b), 'pt-BR', {numeric:true}));
        sorted.forEach(row => {
          const model = helper.modelLabel(row) || '—';
          let atelier = '';
          let suffix = '';
          if (sector === 'costura' || sector === 'sola' || sector === 'palmilha') {
            atelier = atelierNameForSector(row, sector);
            lines.push(`• T ${talaoLabel(row)} · ${model} · ${number(pairs(row))} prs : ${atelier}`);
          } else {
            const status = talaoFactoryStatus(row);
            const montagemStatus = status.complete ? 'Completo' : `Incompleto (${status.pending.join('/')})`;
            lines.push(`• T ${talaoLabel(row)} · ${model} · ${number(pairs(row))} prs : ${montagemStatus}`);
          }
        });
        lines.push(`Total remessa: ${number(rows.length)} talão(ões) · ${number(sumPairs(rows))} pares`, '');
      });
      lines.push(`*TOTAL ${label.toUpperCase()}: ${number(records.length)} talão(ões) · ${number(sumPairs(records))} pares*`);
      return {message:lines.join('\n'), records};
    }

    function openSectorMessage(sector) {
      const {message: textMessage, records} = buildSectorWhatsMessage(sector);
      const label = sectorWhatsLabel(sector);
      if (!textMessage) return;
      if (!records.length) {
        root.alert(`Não há talões abertos para ${label} neste dia e trilho.`);
        return;
      }
      $('sectorMessageTitle').textContent = `${label} · mensagem`;
      $('sectorMessageText').value = textMessage;
      if (!$('sectorMessageModal').open) $('sectorMessageModal').showModal();
      root.setTimeout(() => {
        $('sectorMessageText').focus();
        $('sectorMessageText').select();
      }, 0);
    }

    async function copySectorMessage() {
      const textMessage = $('sectorMessageText').value;
      if (!textMessage) return;
      try {
        await navigator.clipboard.writeText(textMessage);
        $('copySectorMessageButton').textContent = 'Copiado!';
        root.setTimeout(() => { $('copySectorMessageButton').textContent = 'Copiar mensagem'; }, 1400);
      } catch (_) {
        $('sectorMessageText').focus();
        $('sectorMessageText').select();
        try { document.execCommand('copy'); } catch (_) {}
      }
    }

    function closeSectorMessage() {
      if ($('sectorMessageModal').open) $('sectorMessageModal').close();
    }

    function closeWeekDetail() {
      if ($('weekDetailModal').open) $('weekDetailModal').close();
    }

    function openWeekDetail(trackNumber, date, remessaNumber) {
      if (!state.authenticated || state.weekLoading || !state.weekBoard) return;
      const track = state.weekBoard.tracks.find(item => item.track === Number(trackNumber));
      const day = track?.days.find(item => item.date === date);
      const remessa = day?.remessas.find(item => item.remessa === remessaNumber);
      if (!remessa) return;
      const descriptor = state.weekBoard.days.find(item => item.date === date);
      $('weekDetailTitle').textContent = `Remessa ${remessa.remessa || 'sem número'}`;
      $('weekDetailSubtitle').textContent = `Trilho ${String(track.track).padStart(2, '0')} · ${descriptor.label}, ${dateLabel(date)} · ${number(remessa.talaoCount)} talão(ões) · ${number(remessa.pairs)} pares`;
      $('weekDetailBody').innerHTML = remessa.items.map(item => `<tr><td>${escape(item.line || '—')}</td><td>${escape(item.model || '—')}</td><td class="cell-number">${number(item.talaoCount)}</td><td class="cell-number">${number(item.pairs)}</td><td class="cell-number">${number(item.remainingPairs)}</td><td class="cell-number">${number(item.readyPairs)}</td><td class="cell-number">${number(item.mountedPairs)}</td></tr>`).join('');
      $('weekDetailTotals').innerHTML = `<td colspan="2">Total desta programação</td><td class="cell-number">${number(remessa.talaoCount)}</td><td class="cell-number">${number(remessa.pairs)}</td><td class="cell-number">${number(remessa.remainingPairs)}</td><td class="cell-number">${number(remessa.readyPairs)}</td><td class="cell-number">${number(remessa.mountedPairs)}</td>`;
      message('weekDetailMessage', state.weekDirty ? 'O planejamento mudou desde esta consulta. Atualize a semana para conferir os valores atuais.' : '', state.weekDirty ? 'warning' : 'info');
      if (!$('weekDetailModal').open) $('weekDetailModal').showModal();
    }

    function printSheetHTML(title, subtitle, cards) {
      return `<div class="print-sheet-page"><header class="print-sheet-head"><div><strong>Calçados Roma</strong><h1>${escape(title)}</h1><p>${escape(subtitle)}</p></div></header><div class="print-sheet-cards">${cards}</div></div>`;
    }

    function beginPrint(html, mode) {
      const sheet = $('planningPrintSheet');
      const originalParent = sheet.parentNode;
      const originalNext = sheet.nextSibling;
      sheet.innerHTML = html;
      sheet.setAttribute('aria-hidden', 'false');
      // Durante a impressão o quadro fica como filho direto do body para
      // ocultar toda a interface sem esconder o conteúdo impresso.
      document.body.appendChild(sheet);
      document.body.classList.add('planning-custom-print', mode);
      const cleanup = () => {
        document.body.classList.remove('planning-custom-print', 'print-daily-all', 'print-single-track', 'print-week-track', 'print-whole-week', 'print-day-taloes');
        sheet.setAttribute('aria-hidden', 'true');
        sheet.innerHTML = '';
        if (originalParent) originalParent.insertBefore(sheet, originalNext);
        root.removeEventListener('afterprint', cleanup);
      };
      root.addEventListener('afterprint', cleanup);
      root.print();
      root.setTimeout(() => { if (document.body.classList.contains('planning-custom-print')) cleanup(); }, 1500);
    }

    function boardForDate(board, date) {
      const descriptor = board.days.find(item => item.date === date) || {date, label:['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][new Date(`${date}T12:00:00Z`).getUTCDay()]};
      return {descriptor, tracks: board.tracks.map(track => ({track, day: track.days.find(item => item.date === date) || {date, pairs:0, remessas:[]}}))};
    }

    async function loadBoardForDate(date) {
      if (state.weekBoard && date >= state.weekBoard.start && date <= addDays(state.weekBoard.start, 6)) return state.weekBoard;
      const result = await service.loadWeek(date);
      return helper.weekCalendar(result.summary, result.start);
    }

    async function printDaily(date) {
      if (!state.authenticated || state.weekLoading || state.inlineSaving) return;
      try {
        const board = await loadBoardForDate(date);
        const view = boardForDate(board, date);
        const cards = view.tracks.map(({track, day}) => renderTrackDayCard(track, day, view.descriptor, {showPrint:false})).join('');
        const total = view.tracks.reduce((sum, item) => sum + Number(item.day.pairs || 0), 0);
        beginPrint(`<div class="print-sheet-page print-daily-page"><div class="print-daily-title"><strong>Programação do dia ${escape(dateLabel(date))}</strong><span>${escape(view.descriptor.label)} · Total dos trilhos: ${number(total)} pares</span></div><div class="print-sheet-cards">${cards}</div></div>`, 'print-daily-all');
      } catch (error) { message('weekMessage', errorText(error), 'error'); }
    }

    function printSingleTrack(trackNumber, date) {
      if (!state.weekBoard || state.weekDirty || state.weekLoading || state.inlineSaving) return;
      const track = state.weekBoard.tracks.find(item => item.track === Number(trackNumber));
      const descriptor = state.weekBoard.days.find(item => item.date === date);
      const day = track?.days.find(item => item.date === date);
      if (!track || !descriptor || !day) return;
      const card = renderTrackDayCard(track, day, descriptor, {showPrint:false});
      beginPrint(printSheetHTML(`Trilho ${String(track.track).padStart(2,'0')}`, `${descriptor.label}, ${dateLabel(date)} · ${number(day.pairs)} pares programados`, card), 'print-single-track');
    }

    function weeklyTrackCardHTML(trackNumber) {
      const source = document.querySelector(`#trackCards .week-board-track[data-track="${Number(trackNumber)}"]`);
      if (!source) return '';
      const clone = source.cloneNode(true);
      clone.querySelectorAll('button').forEach(button => {
        if (button.classList.contains('week-remessa-link')) {
          const span = document.createElement('span');
          span.className = 'week-remessa-print-label';
          span.textContent = button.textContent;
          button.replaceWith(span);
        } else button.remove();
      });
      return `<div class="print-week-track-page">${clone.outerHTML}</div>`;
    }

    function printWeekTrack(trackNumber) {
      if (!state.weekBoard || state.weekDirty || state.weekLoading || state.inlineSaving) return;
      const html = weeklyTrackCardHTML(trackNumber);
      if (!html) return;
      beginPrint(html, 'print-week-track');
    }

    function printWholeWeek() {
      if (!state.weekBoard || state.weekDirty || state.weekLoading || state.inlineSaving) return;
      const html = state.weekBoard.tracks.map(track => weeklyTrackCardHTML(track.track)).join('');
      if (!html) return;
      beginPrint(html, 'print-whole-week');
    }

    function clearWeek() {
      state.week = state.weekBoard = null;
      state.weekDirty = true;
      closeWeekDetail();
      message('weekOutsideMessage', '');
      ['weekTotalPairs','weekRemainingPairs','weekReadyPairs','weekMountedPairs'].forEach(id => { $(id).textContent = '0'; });
      $('trackCards').innerHTML = '<div class="planning-card empty-state">Consulte uma semana para ver as remessas e os pares de cada trilho por dia.</div>';
    }

    async function navigateWeek(increment, focusTrack = null) {
      if (!state.authenticated || state.weekLoading || state.navigating) return;
      try {
        const today = root.Roma.localISODate();
        $('weekDate').value = increment ? addDays(helper.weekBounds($('weekDate').value || today).start, increment) : today;
        await loadWeek();
        // A navegação de um card troca a semana dos três trilhos. Depois da
        // consulta, o teclado continua no mesmo card para navegar novamente.
        if (focusTrack && state.authenticated && state.tab === 'programacao') {
          document.querySelector(`#trackCards .week-board-track[data-track="${Number(focusTrack)}"] [data-week-offset="${increment}"]`)?.focus();
        }
      } catch (error) { message('weekMessage', errorText(error), 'error'); }
    }

    async function loadWeek() {
      if (!state.authenticated || state.weekLoading) return;
      const request = ++state.weekRequest;
      const commitRevision = state.commitRevision;
      const selectedDate = $('weekDate').value;
      state.weekLoading = true;
      clearWeek();
      message('weekMessage', 'Consultando a programação da semana...');
      $('weekRangeLabel').textContent = 'Consultando a semana selecionada...';
      setControls();
      try {
        const result = await service.loadWeek(selectedDate);
        if (request !== state.weekRequest || !state.authenticated) return;
        state.week = result;
        state.weekDirty = commitRevision !== state.commitRevision || state.inlineSaving;
        renderWeek(result);
        message('weekMessage', state.weekDirty ? 'O planejamento mudou durante esta consulta. Consulte a semana novamente para atualizar o relatório e liberar a impressão.' : state.drafts.size ? 'Este relatório considera o planejamento salvo. Há linhas com trilho ou data incompletos na tabela.' : state.weekBoard.totals.talaoCount ? '' : 'Ainda não há talões programados de segunda a sexta neste período. Defina o trilho e a data na aba Planejamento.', state.weekDirty || state.drafts.size ? 'warning' : 'info');
      } catch (error) {
        if (request !== state.weekRequest) return;
        clearWeek();
        $('weekRangeLabel').textContent = 'Semana não consultada';
        message('weekMessage', errorText(error), 'error');
      } finally {
        if (request === state.weekRequest) { state.weekLoading = false; setControls(); }
      }
    }

    async function switchTab(tab) {
      if (!state.authenticated || state.navigating) return;
      if (tab === 'programacao' && !await prepareNavigation()) return;
      state.tab = tab;
      for (const [name, suffix] of [['planejamento','Planejamento'],['programacao','Programacao']]) {
        const active = tab === name;
        $(`tab${suffix}`).setAttribute('aria-selected', String(active));
        $(`tab${suffix}`).tabIndex = active ? 0 : -1;
        $(`panel${suffix}`).hidden = !active;
      }
      if (tab === 'programacao') void loadWeek();
    }

    function selectedRows() {
      if (!state.modal) return [];
      return state.modal.records.filter(row => state.modal.selected.has(row.id) && !helper.isMounted(row));
    }

    function updateSelection() {
      const modal = state.modal;
      const records = selectedRows();
      const eligible = modal?.records.filter(row => !helper.isMounted(row)) || [];
      const editable = state.authenticated && state.canEdit && modal && !modal.busy && !modal.loading && !modal.stale;
      $('modalSelectionSummary').textContent = !state.canEdit ? 'Consulta dos talões e do planejamento.' : records.length ? `${number(records.length)} de ${number(eligible.length)} talão(ões) disponíveis · ${number(sumPairs(records))} pares selecionados` : 'Nenhum talão selecionado.';
      $('modalSelectAll').checked = !!eligible.length && records.length === eligible.length;
      $('modalSelectAll').indeterminate = records.length > 0 && records.length < eligible.length;
      $('modalSelectAll').disabled = !editable || !eligible.length;
      $('modalTrack').disabled = $('modalDate').disabled = !editable;
      $('savePlanButton').disabled = !editable || !records.length;
      $('clearPlanButton').disabled = !editable || !records.some(row => helper.getPlan(row).track || helper.getPlan(row).date);
      $('savePlanButton').hidden = $('clearPlanButton').hidden = !state.canEdit;
      $('cancelPlanButton').textContent = state.canEdit ? 'Cancelar' : 'Fechar';
      $('closePlanModalButton').disabled = $('cancelPlanButton').disabled = !!modal?.busy;
      $('planModal').setAttribute('aria-busy', String(!!(modal?.busy || modal?.loading)));
      const byId = new Map((modal?.records || []).map(row => [row.id, row]));
      document.querySelectorAll('#planTaloesBody input[type="checkbox"]').forEach(input => {
        const row = byId.get(input.value);
        input.checked = !!modal?.selected.has(input.value) && !!row && !helper.isMounted(row);
        input.disabled = !editable || !row || helper.isMounted(row);
      });
    }

    function renderModalRows() {
      const modal = state.modal;
      if (!modal) return;
      renderModalDetails(modal.records);
      $('planTaloesBody').innerHTML = modal.records.length ? modal.records.map(row => {
        const plan = helper.getPlan(row), mounted = helper.isMounted(row), ready = helper.isReady(row);
        const label = text(row.numeroTalaoSequencial ?? row.numeroTalao) || '—';
        const barcode = text(row.codigoBarrasIdentificador || row.codigoBarras);
        return `<tr data-talao-id="${escape(row.id)}"><td><input type="checkbox" value="${escape(row.id)}" aria-label="Selecionar talão ${escape(label)}${barcode ? `, código ${escape(barcode)}` : ''}"></td><td><div class="cell-stack"><strong>${escape(label)}</strong>${barcode ? `<small class="cell-muted">${escape(barcode)}</small>` : ''}</div></td><td>${escape(row.linha || '—')}</td><td>${escape(helper.modelLabel(row) || '—')}</td><td>${escape(row.corSapato || row.cor || '—')}</td><td class="cell-number">${number(pairs(row))}</td><td><span class="plan-badge ${mounted ? 'mounted' : ready ? 'ready' : 'none'}">${mounted ? 'Já montado' : ready ? 'Pronto para montar' : 'Aguardando talonagem'}</span></td><td>${plan.planned ? `Trilho ${plan.track}` : '—'}</td><td>${plan.planned ? dateLabel(plan.date) : '—'}</td></tr>`;
      }).join('') : '<tr><td colspan="9" class="empty-state">Esta remessa não possui mais talões cadastrados.</td></tr>';
      updateSelection();
    }

    function renderModalDetails(records) {
      const uniqueText = field => [...new Set(records.map(row => text(row[field])).filter(Boolean))];
      const dates = field => [...new Set(records.map(row => calendarDate(row[field])).filter(Boolean))]
        .sort().map(value => dateLabel(value) === '—' ? value : dateLabel(value));
      $('modalCliente').textContent = uniqueText('cliente').join('\n') || 'Não informado';
      $('modalNormativas').textContent = uniqueText('normativa').join('\n') || 'Não informadas';
      $('modalEntrega').textContent = dates('dataEntrega').join('\n') || 'Não informada';
      $('modalCorte').textContent = dates('dataCorte').join('\n') || 'Não informada';
    }

    function replaceKnownRows(records) {
      const updates = new Map(records.map(row => [row.id, row]));
      state.rows = state.rows.map(row => updates.get(row.id) || row);
    }

    // A releitura completa também pode trazer inclusões, exclusões e mudanças
    // cadastrais. Reconcilie a remessa sem incorporar dados fora da consulta.
    function reconcileRemessa(remessa, records) {
      const filter = state.query;
      if (!filter) return;
      const fitsQuery = row => filter.remessa
        ? text(row.numeroRemessa) === filter.remessa
        : typeof row[filter.dateField] === 'string' && row[filter.dateField] >= filter.start && row[filter.dateField] <= filter.end;
      const freshIds = new Set(records.map(row => row.id));
      state.rows = state.rows.filter(row => text(row.numeroRemessa) !== remessa && !freshIds.has(row.id))
        .concat(records.filter(fitsQuery));
    }

    async function openModal(remessa, mode) {
      if (!state.authenticated || state.loading || state.modal?.busy || !await prepareNavigation(remessa)) return;
      const request = ++state.modalRequest;
      const modal = {remessa, mode, records: [], selected: new Set(), loading: true, busy: false, stale: false};
      state.modal = modal;
      $('planModalTitle').textContent = `${state.canEdit && mode === 'remessa' ? 'Planejar remessa' : 'Talões da remessa'} ${remessa}`;
      $('planModalSubtitle').textContent = 'Consultando todos os talões desta remessa, independentemente dos filtros da lista.';
      $('modalTrack').value = $('modalDate').value = '';
      ['modalCliente','modalNormativas','modalEntrega','modalCorte'].forEach(id => { $(id).textContent = '—'; });
      $('planTaloesBody').innerHTML = '<tr><td colspan="9" class="empty-state">Carregando os talões da remessa...</td></tr>';
      message('planModalMessage', 'Carregando os dados atuais da remessa...');
      if (!$('planModal').open) $('planModal').showModal();
      updateSelection();
      try {
        const records = await service.loadRemessa(remessa);
        if (request !== state.modalRequest || !state.modal || !state.authenticated) return;
        modal.records = records;
        modal.loading = false;
        const eligible = records.filter(row => !helper.isMounted(row));
        if (state.canEdit && mode === 'remessa') modal.selected = new Set(eligible.map(row => row.id));
        const plans = selectedRows().map(helper.getPlan);
        if (plans.length && plans.every(plan => plan.planned && plan.track === plans[0].track && plan.date === plans[0].date)) {
          $('modalTrack').value = String(plans[0].track);
          $('modalDate').value = plans[0].date;
        }
        $('planModalSubtitle').textContent = `${number(records.length)} talão(ões) na remessa · ${number(sumPairs(records))} pares no total · ${number(eligible.length)} talão(ões) disponíveis para planejar. Todos os modelos da remessa estão nesta lista.`;
        message('planModalMessage', state.canEdit ? eligible.length ? 'Escolha o trilho e a data para os talões selecionados. Um novo planejamento substitui a previsão anterior desses talões.' : 'Todos os talões desta remessa já foram montados. O planejamento está disponível para consulta.' : 'Modo consulta: você pode conferir os talões e o planejamento de cada um.');
        reconcileRemessa(remessa, records);
        for (const [key, saved] of state.saveStates) {
          if (saved.remessa === remessa) { state.saveStates.delete(key); state.blockedKeys.delete(key); }
        }
        renderPlanning();
        renderModalRows();
      } catch (error) {
        if (request !== state.modalRequest) return;
        modal.loading = false;
        modal.stale = true;
        message('planModalMessage', errorText(error), 'error');
        $('planTaloesBody').innerHTML = '<tr><td colspan="9" class="empty-state">Não foi possível consultar a remessa. Feche esta janela e tente novamente.</td></tr>';
        updateSelection();
      }
    }

    function closeModal() {
      if (state.modal?.busy) return;
      ++state.modalRequest;
      state.modal = null;
      $('planModal').close();
    }

    async function savePlan(clear = false) {
      const modal = state.modal;
      if (!state.authenticated || !state.canEdit || !modal || modal.busy || modal.loading || modal.stale) return;
      const authRequest = state.authRequest;
      const records = selectedRows();
      if (!records.length) { message('planModalMessage', 'Selecione pelo menos um talão.', 'warning'); return; }
      if (clear && !root.confirm(`Limpar o planejamento de ${number(records.length)} talão(ões), com ${number(sumPairs(records))} pares?`)) return;
      const allEligible = modal.records.filter(row => !helper.isMounted(row));
      const track = clear ? 0 : Number($('modalTrack').value);
      const date = clear ? '' : $('modalDate').value;
      const origin = clear ? '' : modal.mode === 'remessa' && records.length === allEligible.length ? 'remessa' : 'talao';
      modal.busy = true;
      updateSelection();
      try {
        const result = await service.savePlan({records, track, date, origin, onProgress: progress => {
          if (authRequest === state.authRequest && state.modal === modal) message('planModalMessage', `Gravando o planejamento: ${number(progress.processed)} de ${number(progress.total)} talão(ões) conferidos. Aguarde a conclusão.`);
        }});
        if (authRequest !== state.authRequest || state.modal !== modal || !state.authenticated) return;
        replaceKnownRows(result.savedRecords);
        state.weekDirty = true;
        if (result.savedRecords.length) ++state.commitRevision;
        if (result.complete) {
          modal.busy = false;
          closeModal();
          renderPlanning();
          const changed = result.savedRecords.length, unchanged = result.unchangedIds.length;
          const unchangedText = unchanged ? ` ${number(unchanged)} talão(ões) já estavam com essa previsão e foram mantidos.` : '';
          message('planningPageMessage', changed ? `${clear ? 'Planejamento limpo' : 'Planejamento salvo'} em ${number(changed)} talão(ões), com ${number(sumPairs(result.savedRecords))} pares.${unchangedText}` : `Nenhuma alteração necessária.${unchangedText}`, 'success');
          return;
        }
        const savedCount = result.savedRecords.length;
        const detail = `Gravação não concluída: ${number(savedCount)} talão(ões) salvos, ${number(result.unchangedIds.length)} já estavam iguais e ${number(result.pendingIds.length)} ficaram sem conclusão. ${errorText(result.error)}`;
        modal.loading = true;
        message('planModalMessage', `${detail} Consultando os dados atuais antes de uma nova tentativa...`, 'error');
        try {
          const fresh = await service.loadRemessa(modal.remessa);
          if (authRequest !== state.authRequest || state.modal !== modal || !state.authenticated) return;
          modal.records = fresh;
          modal.selected = new Set(result.pendingIds.filter(id => fresh.some(row => row.id === id && !helper.isMounted(row))));
          reconcileRemessa(modal.remessa, fresh);
          renderModalRows();
          message('planModalMessage', `${detail} A lista foi atualizada. Confira a seleção, o trilho e a data antes de salvar novamente.`, 'error');
        } catch (refreshError) {
          if (authRequest !== state.authRequest || state.modal !== modal) return;
          modal.stale = true;
          message('planModalMessage', `${detail} Não foi possível atualizar a lista: ${errorText(refreshError)} Feche esta janela e consulte a remessa novamente.`, 'error');
        }
        renderPlanning();
      } catch (error) {
        if (authRequest === state.authRequest && state.modal === modal) message('planModalMessage', errorText(error), 'error');
      } finally {
        modal.busy = modal.loading = false;
        if (authRequest === state.authRequest) { updateSelection(); setControls(); }
      }
    }

    $('searchPlanningButton').addEventListener('click', loadPlanning);
    $('openPlanningCorteDatePicker').addEventListener('click', () => openPlanningDatePicker('corte'));
    $('openPlanningEntregaDatePicker').addEventListener('click', () => openPlanningDatePicker('entrega'));
    $('openPlanningProgramadaDatePicker').addEventListener('click', () => openPlanningDatePicker('programada'));
    ['filterTrilho','filterShowProgrammed','filterShowUnprogrammed','filterShowCompleteMounted','filterShowNotCompleteMounted'].forEach(id => $(id).addEventListener('change', () => { if (state.rows.length) renderPlanning(); }));
    $('planningDatePickerClose').addEventListener('click', () => $('planningDateRangeModal').close());
    $('planningDatePickerApply').addEventListener('click', applyPlanningDatePicker);
    $('planningDatePickerClear').addEventListener('click', () => { planningDatePickerStart = null; planningDatePickerEnd = null; renderPlanningDatePicker(); });
    $('planningDatePickerPrev').addEventListener('click', () => { planningDatePickerMonth = new Date(planningDatePickerMonth.getFullYear(), planningDatePickerMonth.getMonth()-1, 1); renderPlanningDatePicker(); });
    $('planningDatePickerNext').addEventListener('click', () => { planningDatePickerMonth = new Date(planningDatePickerMonth.getFullYear(), planningDatePickerMonth.getMonth()+1, 1); renderPlanningDatePicker(); });
    $('planningDateRangeModal').addEventListener('click', event => { if (event.target === $('planningDateRangeModal')) $('planningDateRangeModal').close(); });
    $('clearPlanningFilters').addEventListener('click', () => loadPlanning({resetFilters:true}));
    ['filterRemessa','filterLinha','filterModelo'].forEach(id => $(id).addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); void loadPlanning(); }
    }));
    $('planningTableBody').addEventListener('input', changeInlinePlan);
    $('planningTableBody').addEventListener('change', changeInlinePlan);
    $('planningTableBody').addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (button && !button.disabled) void openModal(button.dataset.remessa, button.dataset.action);
    });
    $('tabPlanejamento').addEventListener('click', () => switchTab('planejamento'));
    $('tabProgramacao').addEventListener('click', () => switchTab('programacao'));
    [$('tabPlanejamento'), $('tabProgramacao')].forEach(button => button.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const tab = event.key === 'Home' ? 'planejamento' : event.key === 'End' ? 'programacao' : state.tab === 'planejamento' ? 'programacao' : 'planejamento';
      switchTab(tab);
      $(tab === 'planejamento' ? 'tabPlanejamento' : 'tabProgramacao').focus();
    }));
    $('loadWeekButton').addEventListener('click', loadWeek);
    $('weekDate').addEventListener('change', loadWeek);
    [['previousWeekButton',-7],['nextWeekButton',7],['currentWeekButton',0]].forEach(([id, increment]) => $(id).addEventListener('click', () => navigateWeek(increment)));
    $('trackCards').addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      if (button.matches('[data-week-offset]')) {
        const increment = Number(button.dataset.weekOffset);
        if ([-7,7].includes(increment)) void navigateWeek(increment, button.closest('[data-track]').dataset.track);
      } else if (button.matches('[data-day-taloes-track]')) {
        openDayTaloes(button.dataset.dayTaloesTrack, button.dataset.dayTaloesDate);
      } else if (button.matches('[data-week-remessa]')) {
        openWeekDetail(button.dataset.track, button.dataset.date, button.dataset.weekRemessa);
      } else if (button.matches('[data-print-track]')) {
        printSingleTrack(button.dataset.printTrack, button.dataset.printDate);
      } else if (button.matches('[data-print-week-track]')) {
        printWeekTrack(button.dataset.printWeekTrack);
      }
    });
    ['closeWeekDetailButton','cancelWeekDetailButton'].forEach(id => $(id).addEventListener('click', closeWeekDetail));
    $('weekDetailModal').addEventListener('cancel', event => { event.preventDefault(); closeWeekDetail(); });
    ['closeDayTaloesButton','cancelDayTaloesButton'].forEach(id => $(id).addEventListener('click', closeDayTaloes));
    $('dayTaloesModal').addEventListener('cancel', event => { event.preventDefault(); closeDayTaloes(); });
    $('printDayTaloesButton').addEventListener('click', printDayTaloesReport);
    $('whatsCosturaButton').addEventListener('click', () => openSectorMessage('costura'));
    $('whatsSolaButton').addEventListener('click', () => openSectorMessage('sola'));
    $('whatsPalmilhaButton').addEventListener('click', () => openSectorMessage('palmilha'));
    $('whatsMontagemButton').addEventListener('click', () => openSectorMessage('montagem'));
    $('copySectorMessageButton').addEventListener('click', () => void copySectorMessage());
    $('closeSectorMessageButton').addEventListener('click', closeSectorMessage);
    $('cancelSectorMessageButton').addEventListener('click', closeSectorMessage);
    $('sectorMessageModal').addEventListener('cancel', event => { event.preventDefault(); closeSectorMessage(); });
    $('printWeekButton').addEventListener('click', printWholeWeek);
    $('printTodayButton').addEventListener('click', () => printDaily(root.Roma.localISODate()));
    $('printTomorrowButton').addEventListener('click', () => printDaily(addDays(root.Roma.localISODate(), 1)));
    $('printSpecificDateButton').addEventListener('click', () => {
      const date = $('printSpecificDate').value;
      if (!date) return message('weekMessage', 'Escolha a data que deseja imprimir.', 'warning');
      void printDaily(date);
    });
    ['closePlanModalButton','cancelPlanButton'].forEach(id => $(id).addEventListener('click', closeModal));
    $('planModal').addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
    $('modalSelectAll').addEventListener('change', event => {
      if (!state.canEdit || !state.modal || state.modal.busy || state.modal.loading) return;
      state.modal.selected = new Set(event.target.checked ? state.modal.records.filter(row => !helper.isMounted(row)).map(row => row.id) : []);
      updateSelection();
    });
    $('planTaloesBody').addEventListener('change', event => {
      if (!event.target.matches('input[type="checkbox"]') || !state.canEdit || !state.modal || state.modal.busy) return;
      if (event.target.checked) state.modal.selected.add(event.target.value);
      else state.modal.selected.delete(event.target.value);
      updateSelection();
    });
    $('savePlanButton').addEventListener('click', () => savePlan(false));
    $('clearPlanButton').addEventListener('click', () => savePlan(true));
    root.addEventListener('beforeunload', event => {
      if (state.modal?.busy || state.inlineSaving || state.drafts.size) { event.preventDefault(); event.returnValue = ''; }
    });

    setDefaultFilters();
    $('weekDate').value = root.Roma.localISODate();
    $('printSpecificDate').value = root.Roma.localISODate();
    setControls();
    sdk.onAuthStateChanged(auth, async user => {
      const request = ++state.authRequest;
      state.authenticated = false;
      state.canEdit = false;
      ++state.request;
      ++state.weekRequest;
      ++state.modalRequest;
      state.loading = state.weekLoading = false;
      state.rows = [];
      state.query = null;
      state.modal = null;
      clearAutoTimer();
      state.autoRunner = null;
      state.drafts.clear();
      state.saveStates.clear();
      state.blockedKeys.clear();
      state.inlineSaving = state.navigating = false;
      state.savingKey = '';
      ++state.commitRevision;
      message('inlinePlanningMessage', '');
      if ($('planModal').open) $('planModal').close();
      clearWeek();
      renderPlanning();
      $('planningResultNote').textContent = '';
      $('planningTableBody').innerHTML = '<tr><td colspan="22" class="empty-state">Validando o acesso para consultar as remessas...</td></tr>';
      setControls();
      if (!user) { root.location.replace('login.html'); return; }
      try {
        const profile = await sdk.getDoc(sdk.doc(db, 'Usuario', user.email));
        if (request !== state.authRequest) return;
        if (!profile.exists()) throw new Error('Cadastro de usuário não encontrado. Consulte o Admin.');
        root.Roma.validateProfile(user, profile.data());
        const session = root.Roma.session;
        if (!root.SistemaNavegacao.podeAcessar(session.level, 'planejamento.html')) throw new Error('Seu perfil não tem acesso a esta página.');
        root.SistemaNavegacao.init({userLevel:session.level, userName:session.name, title:'Calçados Roma', onLogout:async () => {
          if (state.modal?.busy) { message('planModalMessage', 'Aguarde a conclusão do salvamento para sair.', 'warning'); return; }
          if (!await prepareNavigation('all')) return;
          state.authenticated = false;
          setControls();
          await sdk.signOut(auth);
          root.location.replace('login.html');
        }});
        try {
          localStorage.setItem('calcadosroma-65ac6:userNivelAcesso', session.level);
          localStorage.setItem('calcadosroma-65ac6:userName', session.name);
        } catch (_) { /* O funcionamento não depende do cache local. */ }
        state.authenticated = true;
        state.canEdit = root.Roma.canWrite('planejamento');
        $('readOnlyNotice').hidden = state.canEdit;
        setControls();
        await loadPlanning();
      } catch (error) {
        if (request !== state.authRequest) return;
        state.authenticated = false;
        state.canEdit = false;
        setControls();
        message('planningPageMessage', errorText(error), 'error');
        $('planningTableBody').innerHTML = '<tr><td colspan="22" class="empty-state">Valide o acesso para consultar o planejamento.</td></tr>';
      }
    });
  }

  root.RomaPlanejamentoPage = Object.freeze({start});
})(typeof window !== 'undefined' ? window : globalThis);

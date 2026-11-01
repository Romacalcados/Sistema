/* Planejamento de montagem por talão. Não altera as leituras nem a produção realizada. */
/* Script clássico: a página injeta o SDK do Firestore em create({db, sdk}). */
(function (root) {
  'use strict';

  const TRACKS = Object.freeze(Array.from({length: 3}, (_, index) =>
    Object.freeze({value: index + 1, label: `Trilho ${index + 1}`})));
  const BATCH_SIZE = 200;
  const PLAN_FIELDS = Object.freeze({
    track: 'trilhoMontagemPlanejado', date: 'dataMontagemPlanejada',
    origin: 'planejamentoMontagemOrigem', version: 'planejamentoMontagemVersao'
  });
  const IDENTITY_FIELDS = Object.freeze([
    'numeroRemessa', 'numeroTalaoSequencial', 'linha', 'modelo', 'pares',
    'codigoBarrasIdentificador', 'corSapato', 'numeroTalao', 'codigoBarras',
    'dataCorte', 'dataEntrega'
  ]);
  const text = value => String(value ?? '').trim();
  const compare = (a, b) => String(a).localeCompare(String(b), 'pt-BR', {numeric: true});
  const validTrack = value => Number.isInteger(value) && value >= 1 && value <= 3;

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function calendarDate(value) {
    if (typeof value === 'string') {
      const raw = value.trim();
      if (validDate(raw)) return raw;
      if (/^\d{4}-\d{2}-\d{2}T/.test(raw) && validDate(raw.slice(0, 10))) return raw.slice(0, 10);
      const legacy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const iso = legacy ? `${legacy[3]}-${legacy[2]}-${legacy[1]}` : '';
      return validDate(iso) ? iso : '';
    }
    try {
      const date = typeof value?.toDate === 'function' ? value.toDate() : value instanceof Date ? value : null;
      if (!date || !Number.isFinite(date.getTime())) return '';
      const iso = `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return validDate(iso) ? iso : '';
    } catch (_) { return ''; }
  }

  // Datas antigas também podem estar em DD/MM/YYYY. Um valor histórico presente
  // impede replanejar um talão já montado, sem exigir uma migração do histórico.
  function hasProductionDate(value) {
    if (!value) return false;
    if (typeof value === 'string') return !['', 'N/A', 'Não se aplica'].includes(value.trim());
    if (value instanceof Date) return Number.isFinite(value.getTime());
    if (typeof value?.toDate === 'function') {
      try { return Number.isFinite(value.toDate().getTime()); } catch (_) { return false; }
    }
    return true;
  }

  function getPlan(talao = {}) {
    const track = validTrack(talao[PLAN_FIELDS.track]) ? talao[PLAN_FIELDS.track] : 0;
    const date = validDate(talao[PLAN_FIELDS.date]) ? talao[PLAN_FIELDS.date] : '';
    const rawVersion = talao[PLAN_FIELDS.version];
    const version = Number.isSafeInteger(rawVersion) && rawVersion >= 0 ? rawVersion : 0;
    const origin = ['remessa', 'talao'].includes(talao[PLAN_FIELDS.origin]) ? talao[PLAN_FIELDS.origin] : '';
    return {track, date, version, planned: !!(track && date), origin};
  }

  function isMounted(talao = {}) {
    return hasProductionDate(talao.dataEntradaMontagem)
      || talao.statusGeral === 'Montado'
      || ['Finalizado', 'Montado'].includes(talao.statusMontagem);
  }

  function isReady(talao = {}) {
    return !isMounted(talao) && hasProductionDate(talao.dataEntradaTalonagem);
  }

  function modelLabel(talao = {}) {
    const line = text(talao.linha), model = text(talao.modelo);
    if (!model) return '';
    const digits = value => value.replace(/^0+(?=\d)/, '');
    const full = model.match(/^(\d+)[.\-_/](\d+)$/);
    if (full) return `${digits(full[1])}.${digits(full[2])}`;
    if (!line) return model;
    if (/^\d+$/.test(line) && /^\d+$/.test(model)) return `${digits(line)}.${digits(model)}`;
    return model.startsWith(`${line}.`) ? model : `${line}.${model}`;
  }

  function weekBounds(dateISO) {
    if (!validDate(dateISO)) throw new Error('Informe uma data válida para consultar a semana.');
    const startDate = new Date(`${dateISO}T12:00:00Z`);
    startDate.setUTCDate(startDate.getUTCDate() - ((startDate.getUTCDay() + 6) % 7));
    const endDate = new Date(startDate.getTime());
    endDate.setUTCDate(endDate.getUTCDate() + 6);
    const start = startDate.toISOString().slice(0, 10), end = endDate.toISOString().slice(0, 10);
    if (!validDate(start) || !validDate(end)) throw new Error('A semana informada está fora do intervalo de datas suportado.');
    return {start, end};
  }

  function uniqueRecords(records) {
    const seen = new Set();
    return (Array.isArray(records) ? records : []).filter(record => {
      if (!record || typeof record !== 'object') return false;
      if (!record.id) return true;
      const id = String(record.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function pairsOf(talao) {
    const pairs = Number(talao.pares);
    return Number.isFinite(pairs) && pairs > 0 ? pairs : 0;
  }

  function sortedValues(values, comparator = compare) {
    return [...new Set(values.filter(value => value !== '' && value != null))].sort(comparator);
  }

  function sortRecords(records) {
    return records.sort((a, b) => compare(text(a.numeroRemessa), text(b.numeroRemessa))
      || compare(text(a.numeroTalaoSequencial ?? a.numeroTalao), text(b.numeroTalaoSequencial ?? b.numeroTalao))
      || compare(text(a.linha), text(b.linha)) || compare(modelLabel(a), modelLabel(b))
      || compare(text(a.id), text(b.id)));
  }

  function groupRemessas(records) {
    const groups = new Map();
    for (const record of uniqueRecords(records)) {
      const remessa = text(record.numeroRemessa);
      if (!groups.has(remessa)) groups.set(remessa, []);
      groups.get(remessa).push(record);
    }
    return [...groups.entries()].map(([remessa, rows]) => {
      const plans = rows.map(getPlan), planned = plans.filter(plan => plan.planned);
      const planKeys = new Set(planned.map(plan => `${plan.track}|${plan.date}`));
      const pares = rows.reduce((sum, row) => sum + pairsOf(row), 0);
      const paresMontados = rows.filter(isMounted).reduce((sum, row) => sum + pairsOf(row), 0);
      const plannedPairs = rows.reduce((sum, row, index) => sum + (plans[index].planned ? pairsOf(row) : 0), 0);
      return {
        remessa, records: sortRecords(rows),
        lines: sortedValues(rows.map(row => text(row.linha))),
        models: sortedValues(rows.map(modelLabel)),
        pares, taloes: rows.length, paresPendentes: pares - paresMontados, paresMontados,
        paresProntos: rows.filter(isReady).reduce((sum, row) => sum + pairsOf(row), 0),
        plannedCount: planned.length, plannedPairs, unplannedPairs: pares - plannedPairs,
        planningStatus: !planned.length ? 'none' : planned.length < rows.length ? 'partial' : planKeys.size === 1 ? 'single' : 'split',
        plannedTracks: sortedValues(planned.map(plan => plan.track), (a, b) => a - b),
        plannedDates: sortedValues(planned.map(plan => plan.date)),
        cutDates: sortedValues(rows.map(row => calendarDate(row.dataCorte))),
        deliveryDates: sortedValues(rows.map(row => calendarDate(row.dataEntrega)))
      };
    }).sort((a, b) => compare(a.remessa, b.remessa));
  }

  function emptyTotals() {
    return {pairs: 0, remainingPairs: 0, readyPairs: 0, mountedPairs: 0, talaoCount: 0, remessaCount: 0};
  }

  function addTotals(totals, row) {
    const pairs = pairsOf(row), mounted = isMounted(row);
    totals.pairs += pairs;
    totals.remainingPairs += mounted ? 0 : pairs;
    totals.mountedPairs += mounted ? pairs : 0;
    totals.readyPairs += isReady(row) ? pairs : 0;
    totals.talaoCount++;
  }

  // Resume exatamente os registros fornecidos. loadWeek faz o recorte da semana.
  function weekSummary(records) {
    const tracks = TRACKS.map(track => ({track: track.value, label: track.label, ...emptyTotals(), items: []}));
    const itemMaps = tracks.map(() => new Map()), trackRemessas = tracks.map(() => new Set());
    const totals = emptyTotals(), remessas = new Set();
    for (const row of uniqueRecords(records)) {
      const plan = getPlan(row);
      if (!plan.planned) continue;
      const index = plan.track - 1, track = tracks[index], remessa = text(row.numeroRemessa);
      const line = text(row.linha), model = modelLabel(row);
      const key = JSON.stringify([plan.date, remessa, line, model]);
      if (!itemMaps[index].has(key)) {
        itemMaps[index].set(key, {date: plan.date, remessa, line, model, talaoCount: 0, pairs: 0, remainingPairs: 0, readyPairs: 0, mountedPairs: 0});
      }
      addTotals(itemMaps[index].get(key), row);
      addTotals(track, row);
      addTotals(totals, row);
      trackRemessas[index].add(remessa);
      remessas.add(remessa);
    }
    tracks.forEach((track, index) => {
      track.remessaCount = trackRemessas[index].size;
      track.items = [...itemMaps[index].values()].sort((a, b) => compare(a.date, b.date)
        || compare(a.remessa, b.remessa) || compare(a.line, b.line) || compare(a.model, b.model));
    });
    totals.remessaCount = remessas.size;
    return {tracks, totals};
  }

  // Organiza o quadro de segunda a sexta por dia e remessa. A consulta continua
  // abrangendo a semana inteira; sábado/domingo são contabilizados à parte,
  // sem alterar os planos gravados. weekSummary já conta cada talão uma vez.
  function weekCalendar(summary, dateISO) {
    const {start, end: weekEnd} = weekBounds(dateISO);
    const labels = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
    const shortLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    const days = labels.map((label, index) => {
      const date = new Date(`${start}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + index);
      return {date: date.toISOString().slice(0, 10), label, shortLabel: shortLabels[index], weekend: index >= 5};
    });
    const tracks = TRACKS.map(track => ({track: track.value, label: track.label, ...emptyTotals(),
      days: days.map(day => ({date: day.date, ...emptyTotals(), remessas: []}))}));
    const fields = ['pairs', 'remainingPairs', 'readyPairs', 'mountedPairs', 'talaoCount'];
    const dayMaps = tracks.map(() => new Map(days.map(day => [day.date, new Map()])));

    for (const sourceTrack of Array.isArray(summary?.tracks) ? summary.tracks : []) {
      if (!validTrack(sourceTrack?.track)) continue;
      const index = sourceTrack.track - 1;
      for (const sourceItem of Array.isArray(sourceTrack.items) ? sourceTrack.items : []) {
        if (!sourceItem || !validDate(sourceItem.date) || sourceItem.date < start || sourceItem.date > weekEnd) continue;
        const groups = dayMaps[index].get(sourceItem.date), remessa = text(sourceItem.remessa);
        if (!groups.has(remessa)) groups.set(remessa, {remessa, pairs: 0, remainingPairs: 0,
          readyPairs: 0, mountedPairs: 0, talaoCount: 0, items: []});
        const group = groups.get(remessa), item = {...sourceItem, remessa};
        for (const field of fields) {
          const value = Number(sourceItem[field]);
          item[field] = Number.isFinite(value) && value > 0 ? value : 0;
          group[field] += item[field];
        }
        group.items.push(item);
      }
    }

    const totals = emptyTotals(), weekendTotals = emptyTotals();
    const weekdayRemessas = new Set(), weekendRemessas = new Set();
    tracks.forEach((track, index) => {
      const remessas = new Set();
      track.days.forEach((day, dayIndex) => {
        day.remessas = [...dayMaps[index].get(day.date).values()].sort((a, b) => compare(a.remessa, b.remessa));
        day.remessaCount = day.remessas.length;
        day.remessas.forEach(group => {
          group.items.sort((a, b) => compare(a.line, b.line) || compare(a.model, b.model));
          if (dayIndex < 5) {
            remessas.add(group.remessa);
            weekdayRemessas.add(group.remessa);
          } else weekendRemessas.add(group.remessa);
          fields.forEach(field => { day[field] += group[field]; });
        });
        fields.forEach(field => {
          if (dayIndex < 5) {
            track[field] += day[field];
            totals[field] += day[field];
          } else weekendTotals[field] += day[field];
        });
      });
      track.remessaCount = remessas.size;
      track.days = track.days.slice(0, 5);
    });
    totals.remessaCount = weekdayRemessas.size;
    weekendTotals.remessaCount = weekendRemessas.size;
    return {start, end: days[4].date, days: days.slice(0, 5), tracks, totals, weekendTotals};
  }

  function planningError(code, message, record) {
    const error = new Error(message);
    error.code = `planejamento/${code}`;
    if (record?.id) error.recordId = record.id;
    return error;
  }

  function recordLabel(record) {
    return text(record.codigoBarrasIdentificador || record.codigoBarras)
      || `talão ${text(record.numeroTalaoSequencial ?? record.numeroTalao) || text(record.id)}`;
  }

  function checkedVersion(record) {
    const raw = record[PLAN_FIELDS.version];
    if (raw === undefined) return 0;
    if (!Number.isSafeInteger(raw) || raw < 0 || raw >= Number.MAX_SAFE_INTEGER) {
      throw planningError('versao-invalida', `O planejamento de ${recordLabel(record)} tem uma versão inválida. Atualize a consulta e peça ao Admin para revisar o cadastro.`, record);
    }
    return raw;
  }

  function rawPlan(record) {
    return {
      track: record[PLAN_FIELDS.track] === undefined ? 0 : record[PLAN_FIELDS.track],
      date: record[PLAN_FIELDS.date] === undefined ? '' : record[PLAN_FIELDS.date],
      origin: record[PLAN_FIELDS.origin] === undefined ? '' : record[PLAN_FIELDS.origin]
    };
  }

  function samePlan(a, b) {
    return a.track === b.track && a.date === b.date && a.origin === b.origin;
  }

  function assertCurrent(expected, current) {
    if (IDENTITY_FIELDS.some(field => expected[field] !== current[field])) {
      throw planningError('cadastro-alterado', `Os dados de ${recordLabel(expected)} foram alterados. Atualize a consulta antes de salvar.`, expected);
    }
    if (checkedVersion(expected) !== checkedVersion(current) || !samePlan(rawPlan(expected), rawPlan(current))) {
      throw planningError('conflito', `O planejamento de ${recordLabel(expected)} foi alterado por outra pessoa. Atualize a consulta e confira o novo planejamento.`, expected);
    }
    if (isMounted(current)) {
      throw planningError('ja-montado', `${recordLabel(current)} já foi montado e não pode ser replanejado por esta página. Atualize a consulta.`, current);
    }
  }

  function validateTarget(track, date, origin) {
    if (track === 0 && date === '' && origin === '') return {track, date, origin};
    if (!validTrack(track)) throw planningError('trilho-invalido', 'Selecione um trilho de 1 a 3. Para limpar, remova também a data do planejamento.');
    if (!validDate(date)) throw planningError('data-invalida', 'Informe uma data de montagem válida. O trilho e a data devem ser definidos juntos.');
    if (!['remessa', 'talao'].includes(origin)) throw planningError('origem-invalida', 'Informe se o planejamento foi definido por remessa ou por talão.');
    return {track, date, origin};
  }

  function prepareRecords(records) {
    if (!Array.isArray(records) || !records.length) throw planningError('selecao-vazia', 'Selecione pelo menos um talão para planejar.');
    const unique = new Map();
    for (const row of records) {
      if (!row || typeof row.id !== 'string' || !row.id || row.id.includes('/')) {
        throw planningError('id-invalido', 'Um talão está sem a referência do banco. Atualize a consulta antes de salvar.');
      }
      if (!text(row.numeroRemessa)) throw planningError('remessa-invalida', `O ${recordLabel(row)} está sem remessa. Revise seu cadastro.`, row);
      checkedVersion(row);
      const record = {...row};
      if (unique.has(record.id)) {
        const previous = unique.get(record.id);
        if (IDENTITY_FIELDS.some(field => previous[field] !== record[field])
            || checkedVersion(previous) !== checkedVersion(record) || !samePlan(rawPlan(previous), rawPlan(record))) {
          throw planningError('selecao-conflitante', 'O mesmo talão aparece com versões diferentes na seleção. Atualize a consulta.');
        }
      } else unique.set(record.id, record);
    }
    return [...unique.values()];
  }

  function create({db, sdk} = {}) {
    if (!db || !sdk) throw new Error('O banco e o SDK do Firebase são necessários para carregar o planejamento.');
    const {collection, query, where, doc, runTransaction, serverTimestamp} = sdk;
    const readDocs = sdk.getDocsFromServer || sdk.getDocs;
    if ([collection, query, where, doc, runTransaction, serverTimestamp, readDocs].some(fn => typeof fn !== 'function')) {
      throw new Error('O SDK do Firebase está incompleto para a página de planejamento.');
    }

    async function read(constraints) {
      const snapshot = await readDocs(query(collection(db, 'taloes'), ...constraints));
      return sortRecords(snapshot.docs.map(entry => ({...entry.data(), id: entry.id})));
    }

    async function loadRemessa(remessa) {
      const value = text(remessa);
      if (!value) throw new Error('Informe o número da remessa.');
      return read([where('numeroRemessa', '==', value)]);
    }

    async function loadPlanning({remessa = '', dateField = 'dataCorte', start, end} = {}) {
      if (text(remessa)) return loadRemessa(remessa);
      if (!['dataCorte', 'dataEntrega'].includes(dateField)) throw new Error('Selecione o período de corte ou de entrega.');
      if (!validDate(start) || !validDate(end) || start > end) throw new Error('Informe um período válido, com a data inicial antes ou igual à data final.');
      return read([where(dateField, '>=', start), where(dateField, '<=', end)]);
    }

    async function loadWeek(dateISO) {
      const {start, end} = weekBounds(dateISO);
      const records = await read([where(PLAN_FIELDS.date, '>=', start), where(PLAN_FIELDS.date, '<=', end)]);
      return {start, end, records, summary: weekSummary(records)};
    }

    async function savePlan({records, track, date, origin, onProgress} = {}) {
      if (!root.Roma?.requireWrite) throw new Error('A sessão da Roma não foi carregada. Entre novamente no sistema.');
      root.Roma.requireWrite('planejamento');
      const session = root.Roma.session;
      if (!text(session?.uid) || !text(session?.name)) throw new Error('O responsável pelo planejamento não foi identificado. Entre novamente.');
      const actor = {uid: session.uid, name: session.name};
      const target = validateTarget(track, date, origin), selection = prepareRecords(records);
      const savedRecords = [], unchangedIds = [];
      let processed = 0;
      const progress = () => {
        // Uma falha de apresentação não transforma um commit confirmado em erro.
        try { if (typeof onProgress === 'function') onProgress({processed, total: selection.length}); } catch (_) { /* A gravação permanece confirmada. */ }
      };
      progress();
      for (let offset = 0; offset < selection.length; offset += BATCH_SIZE) {
        const chunk = selection.slice(offset, offset + BATCH_SIZE);
        try {
          root.Roma.requireWrite('planejamento');
          if (root.Roma.session?.uid !== actor.uid) throw planningError('sessao-alterada', 'A sessão foi alterada durante a gravação. Entre novamente e atualize a consulta.');
          const outcome = await runTransaction(db, async transaction => {
            const refs = chunk.map(record => doc(db, 'taloes', record.id));
            // Todas as leituras precedem qualquer escrita. O callback pode ser
            // repetido pelo Firestore; resultados externos só mudam após o commit.
            const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
            const writes = [], unchanged = [];
            snapshots.forEach((snapshot, index) => {
              const expected = chunk[index];
              if (!snapshot.exists()) throw planningError('excluido', `${recordLabel(expected)} foi excluído. Atualize a consulta antes de salvar.`, expected);
              if (snapshot.id !== expected.id) throw planningError('referencia-alterada', 'A referência de um talão não corresponde ao documento consultado. Atualize a página.', expected);
              const current = {...snapshot.data(), id: snapshot.id};
              assertCurrent(expected, current);
              if (samePlan(rawPlan(current), target)) { unchanged.push(current.id); return; }
              const patch = {
                [PLAN_FIELDS.track]: target.track,
                [PLAN_FIELDS.date]: target.date,
                [PLAN_FIELDS.origin]: target.origin,
                [PLAN_FIELDS.version]: checkedVersion(current) + 1,
                planejamentoMontagemAtualizadoEm: serverTimestamp(),
                planejamentoMontagemAtualizadoPor: actor.uid,
                planejamentoMontagemAtualizadoPorNome: actor.name
              };
              writes.push({ref: refs[index], record: {...current, ...patch, id: snapshot.id}, patch});
            });
            writes.forEach(write => transaction.update(write.ref, write.patch));
            return {saved: writes.map(write => write.record), unchanged};
          });
          savedRecords.push(...outcome.saved);
          unchangedIds.push(...outcome.unchanged);
          processed += chunk.length;
          progress();
        } catch (error) {
          return {complete: false, savedRecords, unchangedIds, pendingIds: selection.slice(offset).map(record => record.id), error};
        }
      }
      return {complete: true, savedRecords, unchangedIds, pendingIds: [], error: null};
    }

    return Object.freeze({loadPlanning, loadRemessa, loadWeek, savePlan});
  }

  root.RomaPlanejamento = Object.freeze({TRACKS, getPlan, isMounted, isReady, modelLabel, weekBounds, groupRemessas, weekSummary, weekCalendar, create});
})(typeof window !== 'undefined' ? window : globalThis);

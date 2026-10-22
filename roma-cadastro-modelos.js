/* Cadastro inicial dos modelos encontrados na distribuição; existentes são preservados. */
/* Script clássico para permitir a abertura local; o SDK é fornecido pela página. */
(function (root) {
  'use strict';
  function create({collection, doc, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp}) {
    function digits(value) {
      const raw = String(value ?? '').trim();
      return /^\d+$/.test(raw) ? raw.replace(/^0+(?=\d)/, '') : null;
    }

    function normalizarReferencia(linha, modelo) {
      const line = digits(linha);
      const raw = String(modelo ?? '').trim();
      if (line === null) throw new Error(`Linha inválida: "${String(linha ?? '')}". Informe somente números.`);
      const parts = raw.match(/^(\d+)[.\-_/](\d+)$/);
      if (parts && digits(parts[1]) !== line) {
        throw new Error(`O modelo ${raw} pertence à linha ${digits(parts[1])}, mas a linha informada é ${line}. Corrija antes de salvar.`);
      }
      const short = digits(parts ? parts[2] : raw);
      if (short === null) throw new Error(`Modelo inválido na linha ${line}: "${raw}". Use o código do modelo ou a referência linha.modelo.`);
      return {linha: line, modelo: short, chave: `${line}.${short}`};
    }

    function prepararReferenciasDistribuicao(itens) {
      if (!Array.isArray(itens) || !itens.length) throw new Error('A distribuição precisa conter pelo menos um modelo válido.');
      const unique = new Map();
      for (const item of itens) {
        const ref = normalizarReferencia(item.linha, item.modelo);
        unique.set(ref.chave, ref);
      }
      return [...unique.values()];
    }

    function recordKey(data, id) {
      try { return normalizarReferencia(data.linha, data.modelo).chave; }
      catch (_) {
        for (const value of [data.chave, id]) {
          const parts = String(value ?? '').match(/^(\d+)[.\-_/](\d+)$/);
          if (parts) return normalizarReferencia(parts[1], parts[2]).chave;
        }
        return '';
      }
    }

    function existingKeys(snapshots) {
      const keys = new Set();
      for (const snapshot of snapshots) {
        for (const entry of snapshot.docs) {
          const key = recordKey(entry.data(), entry.id);
          if (key) keys.add(key);
        }
      }
      return keys;
    }

    function novoCadastroModelo(ref, email, timestamp) {
      const normalized = normalizarReferencia(ref.linha, ref.modelo);
      return {
        ...normalized,
        categoria: '', subcategoria: '', observacaoModelo: '',
        componentes: {...window.Roma.LEGACY_COMPONENTS},
        preco: {valor: 0, setores: {}}, totalSetores: 0, saldo: 0,
        ativo: true, origem: 'Distribuicao', criadoEm: timestamp,
        atualizadoEm: timestamp, atualizadoPor: email, historico: []
      };
    }

    function describeError(error) {
      if (error?.code === 'permission-denied') {
        return 'A criação foi recusada pelo Firebase. Confira as regras atualizadas; se houver cadastros antigos, peça ao Admin para executar Preparação da Roma.';
      }
      if (['unavailable', 'deadline-exceeded'].includes(error?.code)) {
        return 'A conexão com o banco foi interrompida. Salve a distribuição novamente para concluir os modelos pendentes.';
      }
      return error?.message || 'Não foi possível concluir o cadastro deste modelo.';
    }

    async function cadastrarModelosDaDistribuicao(db, referencias, {onProgress} = {}) {
      window.Roma.requireWrite('planejamento');
      const session = window.Roma.session;
      const refs = prepararReferenciasDistribuicao(referencias);
      const canReadFinancial = ['08', '09'].includes(session.level);
      const result = {verificados: refs.length, criados: [], existentes: [], pendentes: []};
      const reads = [getDocsFromServer(collection(db, 'modelosOperacionais'))];
      if (canReadFinancial) reads.push(getDocsFromServer(collection(db, 'modelos')));
      const known = existingKeys(await Promise.all(reads));

      for (let index = 0; index < refs.length; index++) {
        const ref = refs[index];
        try {
          if (known.has(ref.chave)) {
            result.existentes.push(ref.chave);
          } else {
            const created = await runTransaction(db, async transaction => {
              const modelRef = doc(db, 'modelos', ref.chave);
              const operationalRef = doc(db, 'modelosOperacionais', ref.chave);
              const pricesRef = doc(db, 'precosAtelier', ref.chave);
              const snapshots = await Promise.all([
                transaction.get(operationalRef), transaction.get(pricesRef),
                ...(canReadFinancial ? [transaction.get(modelRef)] : [])
              ]);
              const [operational, prices, financial] = snapshots;
              const existing = [operational, financial].filter(snap => snap?.exists());
              if (existing.length) {
                if (existing.some(snap => recordKey(snap.data(), snap.id) !== ref.chave)) {
                  throw new Error(`A referência ${ref.chave} já está ocupada por outro cadastro. Peça ao Admin para revisar Modelos.`);
                }
                return false;
              }
              if (prices.exists()) {
                throw new Error(`Há preços antigos para ${ref.chave} sem cadastro operacional correspondente. Peça ao Admin para revisar a Preparação da Roma.`);
              }
              const timestamp = serverTimestamp();
              const data = novoCadastroModelo(ref, session.email, timestamp);
              const projections = window.RomaModelos.projections(data, timestamp);
              transaction.set(modelRef, data);
              transaction.set(operationalRef, projections.operacional);
              transaction.set(pricesRef, projections.precos);
              return true;
            });
            (created ? result.criados : result.existentes).push(ref.chave);
            known.add(ref.chave);
          }
        } catch (error) {
          // Um concorrente pode completar o cadastro antes do commit. O perfil 07
          // não tem update; reconheça o vencedor pelas projeções permitidas.
          if (error?.code === 'permission-denied') {
            try {
              const snapshots = await Promise.all([
                getDocFromServer(doc(db, 'modelosOperacionais', ref.chave)),
                getDocFromServer(doc(db, 'precosAtelier', ref.chave))
              ]);
              if (snapshots.every(snap => snap.exists() && recordKey(snap.data(), snap.id) === ref.chave)) {
                result.existentes.push(ref.chave);
                known.add(ref.chave);
                onProgress?.({...result, concluidos: index + 1, total: refs.length});
                continue;
              }
            } catch (_) { /* A pendência original continua visível ao usuário. */ }
          }
          result.pendentes.push({chave: ref.chave, motivo: describeError(error)});
          if (['permission-denied', 'unauthenticated', 'unavailable', 'deadline-exceeded'].includes(error?.code)) {
            for (const remaining of refs.slice(index + 1)) {
              if (known.has(remaining.chave)) result.existentes.push(remaining.chave);
              else result.pendentes.push({chave: remaining.chave, motivo: 'Verificação interrompida; salve a distribuição novamente após resolver a falha indicada.'});
            }
            onProgress?.({...result, concluidos: refs.length, total: refs.length});
            break;
          }
        }
        onProgress?.({...result, concluidos: index + 1, total: refs.length});
      }
      return result;
    }

    return Object.freeze({normalizarReferencia, prepararReferenciasDistribuicao, novoCadastroModelo, cadastrarModelosDaDistribuicao});
  }
  root.RomaCadastroModelos = Object.freeze({create});
})(typeof window !== 'undefined' ? window : globalThis);

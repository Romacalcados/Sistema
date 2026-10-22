/* Fluxos dos ateliês: identidade estável, escopo das consultas e transições.
   As regras do Firestore aplicam as mesmas restrições no servidor. */
(function () {
  'use strict';
  const sectors = Object.freeze({
    costura: Object.freeze({ key: 'costura', name: 'Costura', level: '03', owner: 'atelieCosturaId', ownerName: 'idAtelieResponsavel', status: 'statusCostura', entry: 'costuraDataInicio', actor: 'costuraUsuario', exit: 'dataSaidaCostura' }),
    sola: Object.freeze({ key: 'sola', name: 'Sola', level: '04', owner: 'atelieSolaId', ownerName: 'idAtelieSolaResponsavel', status: 'statusSola', entry: 'solaDataInicio', actor: 'solaUsuario', exit: 'dataSaidaSola' }),
    palmilha: Object.freeze({ key: 'palmilha', name: 'Palmilha', level: '05', owner: 'ateliePalmilhaId', ownerName: 'idAteliePalmilhaResponsavel', status: 'statusPalmilha', entry: 'palmilhaDataInicio', actor: 'palmilhaUsuario', exit: 'dataSaidaPalmilha' })
  });
  const path = String(window.location.pathname || '').split('/').pop().toLowerCase();
  const current = sectors[path.startsWith('sola_') ? 'sola' : path.startsWith('palmilha_') ? 'palmilha' : 'costura'];
  const generalLevels = Object.freeze(['07', '08', '09']);

  function validProfile(user, profile, mode = 'report', sector = current) {
    const allowed = mode === 'scan' ? [sector.level, '09'] : [sector.level, ...generalLevels];
    return !!user && !!profile && profile.uid === user.uid && profile.ativo === true
      && profile.permissoesVersao === 2 && allowed.includes(String(profile.nivelAcesso || ''));
  }

  function canSelectAtelier(level) {
    return generalLevels.includes(String(level));
  }

  function applicable(talao, sector = current) {
    return sector.key === 'costura' || talao?.componentes?.[sector.key] === true;
  }

  function selectedOwner(level, uid, selected = '', sector = current) {
    if (String(level) === sector.level) {
      if (!uid) throw new Error('Identidade do ateliê ainda não validada. Entre novamente.');
      return uid;
    }
    if (canSelectAtelier(level)) return String(selected || '');
    throw new Error('Perfil sem acesso a este setor.');
  }

  function scopeCompat(query, level, uid, selected = '', sector = current) {
    const owner = selectedOwner(level, uid, selected, sector);
    return owner ? query.where(sector.owner, '==', owner) : query;
  }

  function localISODate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function scanUpdate(talao, action, context, sector = current, date = localISODate()) {
    const level = String(context?.level || '');
    if (![sector.level, '09'].includes(level) || !context?.uid) throw new Error('Seu perfil não pode registrar entradas ou saídas deste setor.');
    if (level !== '09' && talao?.[sector.owner] !== context.uid) throw new Error('Talão não atribuído ao seu ateliê.');
    if (!talao?.[sector.owner]) throw new Error('Defina o ateliê responsável no Corte antes de registrar a leitura.');
    if (!applicable(talao, sector)) throw new Error(`Este modelo não contém ${sector.name.toLowerCase()}.`);
    const status = String(talao?.[sector.status] || '');
    if (action === 'entrada') {
      if (status === 'Em Produção' || talao?.[sector.entry]) throw new Error('A entrada deste talão já foi registrada.');
      if (status === 'Finalizado' || talao?.[sector.exit]) throw new Error('Este talão já foi finalizado neste setor.');
      if (sector.key === 'costura' && ['Finalizado', 'Costurado', 'Distribuído', 'Talonado', 'Montando', 'Montado'].includes(talao?.statusGeral)) throw new Error('Este talão já passou pela costura. Confira os registros antes de nova leitura.');
      const patch = { [sector.status]: 'Em Produção', [sector.entry]: date, [sector.actor]: String(context.name || '') };
      if (sector.key === 'costura') patch.statusGeral = 'Costurando';
      return patch;
    }
    if (action === 'saida') {
      if (status !== 'Em Produção' || !talao?.[sector.entry]) throw new Error('Registre a entrada deste talão antes da saída.');
      if (talao?.[sector.exit]) throw new Error('A saída deste talão já foi registrada.');
      const patch = { [sector.status]: 'Finalizado', [sector.exit]: date };
      if (sector.key === 'costura') patch.statusGeral = 'Costurado';
      return patch;
    }
    throw new Error('Operação de leitura inválida.');
  }

  window.RomaSetores = Object.freeze({ sectors, current, validProfile, canSelectAtelier, applicable, selectedOwner, scopeCompat, localISODate, scanUpdate });
})();

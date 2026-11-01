/* Recebimentos na fábrica e conferência única da Talonagem. */
(function (root) {
  'use strict';
  const MODES = Object.freeze({
    costura: {title:'Recebimento Costura',sector:'costura',input:'barcodeInputDistribuicao',message:'distribuicaoMessage',success:'Costura recebida na fábrica.',record:'Recebido'},
    sola: {title:'Recebimento Sola',sector:'sola',input:'barcodeInputRecebimentoSola',message:'recebimentoSolaMessage',success:'Sola recebida na fábrica.',record:'Recebido'},
    palmilha: {title:'Recebimento Palmilha',sector:'palmilha',input:'barcodeInputRecebimentoPalmilha',message:'recebimentoPalmilhaMessage',success:'Palmilha recebida na fábrica.',record:'Recebido'},
    talonagem: {title:'Talonagem',input:'barcodeInputTalonagem',message:'talonagemMessage',success:'Conjunto conferido. Talão registrado na Talonagem.',record:'Talonado'}
  });
  function escape(value) { return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function formatDate(value) {
    const text=String(value||'');
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text.slice(8,10)}/${text.slice(5,7)}/${text.slice(0,4)}` : text;
  }
  function barcodeCandidates(raw) {
    const clean=String(raw||'').trim().replace(/\s+/g,'');
    if(!clean || clean.length>150) throw new Error('Informe um código de barras válido.');
    const values=[clean];
    // Compatibilidade com os leitores usados nas páginas antigas da fábrica.
    if(clean.length>1) values.push(clean.startsWith('1') ? clean.slice(1) : '1'+clean.slice(1));
    return [...new Set(values)];
  }
  function fieldsFor(mode) {
    return mode==='talonagem' ? {date:'dataEntradaTalonagem',user:'usuarioTalonagem'} : root.Roma.FACTORY_RECEIPTS[mode];
  }
  function create({db,sdk,mode}) {
    if(!MODES[mode]) throw new Error('Página de fábrica inválida.');
    const {collection,query,where,limit,getDocs,doc,runTransaction}=sdk;
    async function findByBarcode(raw) {
      for(const candidate of barcodeCandidates(raw)) {
        const snap=await getDocs(query(collection(db,'taloes'),where('codigoBarrasIdentificador','==',candidate),limit(2)));
        if(snap.size>1) throw new Error('Este código está cadastrado em mais de um talão. Solicite a correção ao Cadastro ou Admin.');
        if(!snap.empty) return {data:snap.docs[0].data(),id:snap.docs[0].id,candidate};
      }
      throw new Error('Talão não encontrado. Confira o código de barras.');
    }
    async function register(raw) {
      root.Roma.requireWrite('montagem');
      const session=root.Roma.session;
      const found=await findByBarcode(raw);
      let current={...found.data,id:found.id};
      try {
        return await runTransaction(db,async transaction=>{
          root.Roma.requireWrite('montagem');
          if(root.Roma.session?.uid!==session.uid) throw new Error('A sessão mudou. Entre novamente antes de registrar a leitura.');
          const ref=doc(db,'taloes',found.id),snapshot=await transaction.get(ref);
          if(!snapshot.exists()) throw new Error('Este talão foi excluído. Confira o código novamente.');
          current={...snapshot.data(),id:found.id};
          if(current.codigoBarrasIdentificador!==found.candidate) throw new Error('O código deste talão foi alterado. Faça uma nova leitura.');
          const date=root.Roma.localISODate();
          const patch=mode==='talonagem' ? root.Roma.talonagemPatch(current,date,session.name) : root.Roma.factoryReceiptPatch(current,mode,date,session.name);
          transaction.update(ref,patch);
          return {...current,...patch};
        });
      } catch(error) {
        error.talao=current;
        throw error;
      }
    }
    async function history(date) {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Selecione a data dos registros.');
      const snap=await getDocs(query(collection(db,'taloes'),where(fieldsFor(mode).date,'==',date)));
      return snap.docs.map(item=>({...item.data(),id:item.id})).sort((a,b)=>String(a.codigoBarrasIdentificador||'').localeCompare(String(b.codigoBarrasIdentificador||''),'pt-BR',{numeric:true}));
    }
    return Object.freeze({register,history});
  }
  function errorText(error) {
    if(String(error?.code||'').includes('permission-denied')) return 'Registro não autorizado. Confira seu perfil e se as regras atualizadas do Firebase foram publicadas.';
    if(['unavailable','failed-precondition','deadline-exceeded'].some(code=>String(error?.code||'').includes(code))) return 'Não foi possível confirmar a operação. Confira a conexão e atualize os registros antes de tentar novamente.';
    return error?.message || 'Não foi possível registrar esta leitura.';
  }
  function errorSound() {
    try {
      const Audio=root.AudioContext||root.webkitAudioContext;
      if(!Audio) return;
      const context=new Audio(),tone=context.createOscillator(),gain=context.createGain();
      tone.type='sine'; tone.frequency.value=350; gain.gain.value=.08;
      tone.connect(gain); gain.connect(context.destination); tone.start(); tone.stop(context.currentTime+.16);
      tone.onended=()=>context.close();
    } catch (_) { /* A mensagem visual continua disponível. */ }
  }
  function start({auth,db,sdk,mode}) {
    if(!root.Roma?.factoryChecks || !root.Roma?.factoryReceiptPatch) throw new Error('Atualize também roma-core.js e roma-fabrica.js junto com esta página.');
    const config=MODES[mode];
    if(!config) throw new Error('Página de fábrica inválida.');
    const service=create({db,sdk,mode}),$=id=>document.getElementById(id);
    const input=$(config.input),message=$(config.message),submit=$('registerButton'),engine=$('engineStatus');
    let authenticated=false,busy=false,historyRows=[],historyRequest=0,visibleRows=100,commitRevision=0;
    const sessionCommits=new Map();
    const setMessage=(text,type='info')=>{message.textContent=text;message.className=`factory-message ${type}`;};
    function setControls() {
      const enabled=authenticated && root.Roma.canWrite('montagem') && !busy;
      input.disabled=!enabled;submit.disabled=!enabled;
      engine.textContent=!authenticated?'Validando acesso':busy?'Registrando':enabled?'Leitor pronto':'Consulta';
    }
    function ownerLabel(talao) {
      if(config.sector) return talao[root.Roma.SECTORS[config.sector].nameField] || 'Sem responsável';
      return root.Roma.factoryChecks(talao).filter(check=>check.applicable).map(check=>`${check.label}: ${talao[root.Roma.SECTORS[check.sector].nameField]||'Sem responsável'}`).join(' · ');
    }
    function renderHistory() {
      $('historyCount').textContent=historyRows.length.toLocaleString('pt-BR');
      $('historyPairs').textContent=historyRows.reduce((sum,t)=>sum+(Number(t.pares)||0),0).toLocaleString('pt-BR');
      const fields=fieldsFor(mode);
      $('scannedListBody').innerHTML=historyRows.length ? historyRows.slice(0,visibleRows).map(t=>`<tr>
        <td>${escape(t.codigoBarrasIdentificador)}</td><td>${escape(t.linha)}</td><td>${escape(t.modelo)}</td>
        <td class="factory-number">${escape(Number(t.pares)||0)}</td><td class="factory-owner-cell">${escape(ownerLabel(t))}</td>
        <td>${escape(t[fields.user]||'Não informado')}</td><td>${escape(formatDate(t[fields.date]))}</td>
        <td><span class="factory-tag success">${escape(config.record)}</span></td></tr>`).join('')
        : '<tr><td colspan="8" class="factory-empty">Nenhum registro nesta data.</td></tr>';
      $('moreHistoryButton').hidden=historyRows.length<=visibleRows;
      $('historyLimit').textContent=historyRows.length>visibleRows ? `Mostrando ${visibleRows} de ${historyRows.length} talões.` : '';
    }
    async function refreshHistory() {
      if(!authenticated) return;
      const request=++historyRequest;
      const date=$('historyDate').value,startedAtRevision=commitRevision;
      $('loadHistoryButton').disabled=true;
      $('historyMessage').textContent='Buscando registros...';
      try {
        const records=await service.history(date);
        if(request!==historyRequest) return;
        const merged=new Map(records.map(record=>[record.id,record]));
        // Preserva leituras confirmadas enquanto esta consulta estava em andamento.
        sessionCommits.forEach(commit=>{
          if(commit.revision>startedAtRevision && commit.data[fieldsFor(mode).date]===date) merged.set(commit.data.id,commit.data);
        });
        historyRows=[...merged.values()];visibleRows=100;renderHistory();
        $('historyMessage').textContent='';
      } catch(error) {
        if(request!==historyRequest) return;
        historyRows=[];renderHistory();
        $('historyMessage').textContent=`Não foi possível carregar os registros. ${errorText(error)}`;
        $('scannedListBody').innerHTML='<tr><td colspan="8" class="factory-empty">Consulta indisponível. Clique em Atualizar para tentar novamente.</td></tr>';
      } finally {
        if(request===historyRequest) $('loadHistoryButton').disabled=false;
      }
    }
    function showChecks(talao) {
      $('factoryCheckCard').hidden=false;
      const line=String(talao.linha||''),model=String(talao.modelo||'');
      const reference=line && model && !model.startsWith(line+'.') ? `${line}.${model}` : model || line;
      $('checkTalao').textContent=`Talão ${talao.numeroTalaoSequencial||talao.codigoBarrasIdentificador||''} · ${reference}`;
      $('factoryChecks').innerHTML=root.Roma.factoryChecks(talao).map(check=>{
        const kind=!check.applicable?'na':check.ready?'success':'pending';
        const text=!check.applicable?'Não faz parte deste modelo':!check.finished?'Saída do ateliê pendente':!check.received?'Aguardando recebimento na fábrica':`Recebido em ${formatDate(check.receiptDate)}`;
        return `<li class="factory-check ${kind}" data-sector="${escape(check.sector)}"><strong>${escape(check.label)}</strong><span>${escape(text)}</span></li>`;
      }).join('');
    }
    async function processBarcode(event) {
      event.preventDefault();
      if(busy || !authenticated || !root.Roma.canWrite('montagem')) return;
      const code=input.value.trim();
      if(!code) {setMessage('Leia ou digite o código do talão.','error');input.focus();return;}
      busy=true;setControls();setMessage('Conferindo o talão...');
      $('factoryCheckCard').hidden=true;
      try {
        const result=await service.register(code);
        showChecks(result);
        setMessage(`${config.success} Código: ${result.codigoBarrasIdentificador}.`,'success');
        sessionCommits.set(result.id,{revision:++commitRevision,data:result});
        // Atualiza o registro confirmado sem consultar novamente todos os talões do dia.
        if($('historyDate').value===result[fieldsFor(mode).date]) {
          historyRows=[result,...historyRows.filter(item=>item.id!==result.id)];renderHistory();
        }
      } catch(error) {
        if(error.talao) showChecks(error.talao);
        setMessage(errorText(error),'error');errorSound();
      } finally {
        busy=false;setControls();input.value='';if(!input.disabled) input.focus();
      }
    }
    $('scanForm').addEventListener('submit',processBarcode);
    $('loadHistoryButton').addEventListener('click',refreshHistory);
    $('historyDate').addEventListener('change',refreshHistory);
    $('moreHistoryButton').addEventListener('click',()=>{visibleRows+=100;renderHistory();});
    $('historyDate').value=root.Roma.localISODate();
    setControls();
    sdk.onAuthStateChanged(auth,async user=>{
      authenticated=false;setControls();
      if(!user) {location.replace('login.html');return;}
      try {
        const profile=await sdk.getDoc(sdk.doc(db,'Usuario',user.email));
        if(!profile.exists()) throw new Error('Cadastro de usuário não encontrado. Consulte o Admin.');
        root.Roma.validateProfile(user,profile.data());
        if(!root.SistemaNavegacao.podeAcessar(root.Roma.session.level,location.pathname.split('/').pop())) throw new Error('Seu perfil não tem acesso a esta página.');
        root.SistemaNavegacao.init({userLevel:root.Roma.session.level,userName:root.Roma.session.name,title:'Controle de produção Calçados Roma',onLogout:async()=>{
          authenticated=false;setControls();
          await sdk.signOut(auth);location.replace('login.html');
        }});
        localStorage.setItem('calcadosroma-65ac6:userNivelAcesso',root.Roma.session.level);
        localStorage.setItem('calcadosroma-65ac6:userName',root.Roma.session.name);
        authenticated=true;setControls();
        if(root.Roma.canWrite('montagem')) {setMessage('Leitor pronto. Leia um talão por vez.');input.focus();}
        else setMessage('Modo consulta. Os registros são feitos pela Montagem ou pelo Admin.');
        await refreshHistory();
      } catch(error) {
        authenticated=false;setControls();setMessage(errorText(error),'error');
        $('historyMessage').textContent='Valide o acesso antes de consultar os registros.';
      }
    });
    return service;
  }
  root.RomaFabrica=Object.freeze({create,start,barcodeCandidates});
})(typeof window!=='undefined'?window:globalThis);

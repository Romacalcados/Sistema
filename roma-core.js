/* Calçados Roma: perfis, componentes e campos operacionais compartilhados. */
(function (root) {
  'use strict';
  const ROLES = Object.freeze({ '01':'Cadastro', '02':'Corte', '03':'Costura', '04':'Sola', '05':'Palmilha', '06':'Montagem', '07':'Programação', '08':'Financeiro', '09':'Admin' });
  const SECTORS = Object.freeze({
    costura: Object.freeze({ key:'costura', name:'Costura', label:'Costura', level:'03', owner:'atelieCosturaId', ownerField:'atelieCosturaId', nameField:'idAtelieResponsavel', originField:'origemAtelieCostura', distributionField:'distribuicaoCosturaId', status:'statusCostura', statusField:'statusCostura', start:'costuraDataInicio', user:'costuraUsuario', end:'dataSaidaCostura' }),
    sola: Object.freeze({ key:'sola', name:'Sola', label:'Sola', level:'04', owner:'atelieSolaId', ownerField:'atelieSolaId', nameField:'idAtelieSolaResponsavel', originField:'origemAtelieSola', distributionField:'distribuicaoSolaId', status:'statusSola', statusField:'statusSola', start:'solaDataInicio', user:'solaUsuario', end:'dataSaidaSola' }),
    palmilha: Object.freeze({ key:'palmilha', name:'Palmilha', label:'Palmilha', level:'05', owner:'ateliePalmilhaId', ownerField:'ateliePalmilhaId', nameField:'idAteliePalmilhaResponsavel', originField:'origemAteliePalmilha', distributionField:'distribuicaoPalmilhaId', status:'statusPalmilha', statusField:'statusPalmilha', start:'palmilhaDataInicio', user:'palmilhaUsuario', end:'dataSaidaPalmilha' })
  });
  const COMPONENTS = Object.freeze(['cabedal','forro','tiras','aviamentos','palmilha','sola']);
  const CUT_COMPONENTS = Object.freeze(['cabedal','forro','tiras','aviamentos']);
  const CUT_FIELDS = Object.freeze({cabedal:'cabedal',forro:'forro',tiras:'tiras',aviamentos:'aviamento'});
  const LEGACY_COMPONENTS = Object.freeze({cabedal:true,forro:true,tiras:true,aviamentos:true,palmilha:false,sola:false});
  let session = null;
  function normalizeComponents(data) {
    const raw = data && (data.componentes || (COMPONENTS.some(k=>typeof data[k]==='boolean') ? data : null));
    if (!raw || typeof raw !== 'object' || !COMPONENTS.some(k=>typeof raw[k]==='boolean')) return {...LEGACY_COMPONENTS};
    return Object.fromEntries(COMPONENTS.map(k=>[k,raw[k]===true]));
  }
  function requiresComponent(data, key) { return normalizeComponents(data)[key==='aviamento'?'aviamentos':key]===true; }
  function hasDate(value) { return !!value && value !== 'N/A' && value !== 'Não se aplica'; }
  function cutItemComplete(data,key) { const f=CUT_FIELDS[key==='aviamento'?'aviamentos':key]; return !requiresComponent(data,key) || (typeof data?.[f+'Concluido']==='boolean' ? data[f+'Concluido'] : hasDate(data?.[f+'Data'])); }
  function cutComplete(data) { return CUT_COMPONENTS.every(k=>cutItemComplete(data,k)); }
  function cutStarted(data) { return CUT_COMPONENTS.some(k=>requiresComponent(data,k) && cutItemComplete(data,k)); }
  function productionStarted(data) {
    const activeStatuses=['Em Produção','Em produção','Finalizado','Concluído','Montado'];
    return Object.values(CUT_FIELDS).some(f=>data?.[f+'Concluido']===true || hasDate(data?.[f+'Data']))
      || Object.values(SECTORS).some(s=>hasDate(data?.[s.start])||hasDate(data?.[s.end])||activeStatuses.includes(data?.[s.status]))
      || ['dataEntradaDistribuicao','dataEntradaTalonagem','dataEntradaMontagem'].some(f=>hasDate(data?.[f]));
  }
  function cutCompletionDate(data) {
    if (!cutComplete(data)) return null;
    return CUT_COMPONENTS.filter(k=>requiresComponent(data,k)).map(k=>data?.[CUT_FIELDS[k]+'Data']).filter(hasDate).map(v=>v?.toDate ? v.toDate().toISOString().slice(0,10) : String(v).slice(0,10)).sort().at(-1) || null;
  }
  function stageApplicable(data,sector) { return sector==='costura' || requiresComponent(data,sector); }
  function stageComplete(data,sector) { const s=SECTORS[sector]; return !stageApplicable(data,sector) || data?.[s.status]==='Finalizado' || hasDate(data?.[s.end]); }
  function modelKey(linha,modelo) {
    const l=String(linha??'').trim().replace(/\D/g,''),m=String(modelo??'').trim();
    const parts=m.split(/[.\-_\/]/).filter(Boolean);
    const short=parts.length>1&&Number(parts[0].replace(/\D/g,''))===Number(l) ? parts.slice(1).join('') : m;
    const value=short.replace(/\D/g,'');
    return l&&value?`${Number(l)}.${Number(value)}`:'';
  }
  function modelKeys(linha,modelo) {
    const l=String(linha??'').trim(),m=String(modelo??'').trim();
    const lDigits=l.replace(/\D/g,''), parts=m.split(/[.\-_\/]/).filter(Boolean);
    const short=parts.length>1&&Number(parts[0].replace(/\D/g,''))===Number(lDigits) ? parts.slice(1).join('') : m;
    const mDigits=short.replace(/\D/g,'');
    const canonical=modelKey(linha,modelo);
    return [...new Set([`${lDigits}.${mDigits}`,canonical,`${lDigits}-${mDigits}`,`${lDigits}_${mDigits}`,`${l}.${m}`,m].filter(Boolean))];
  }
  function assignmentPatch(sector, atelier, origem='corte', distributionId='') {
    const s=SECTORS[sector]; if(!s) throw new Error('Setor inválido.');
    if(!['corte','distribuicao','migracao'].includes(origem)) throw new Error('Origem de atribuição inválida.');
    const id=atelier ? String(atelier.id||atelier.uid||'') : '';
    if(atelier && (!id || atelier.setor!==sector || atelier.ativo===false)) throw new Error('Selecione um ateliê ativo deste setor.');
    return {[s.owner]:id,[s.nameField]:atelier ? String(atelier.nome||atelier.Nome||'') : '',[s.originField]:origem,[s.distributionField]:String(distributionId||'')};
  }
  function validateProfile(user,profile) {
    if(!user || !profile || profile.uid!==user.uid || profile.ativo!==true || !Object.hasOwn(ROLES,String(profile.nivelAcesso||''))) throw new Error('Acesso desativado ou perfil incompatível. Consulte o administrador.');
    if(profile.permissoesVersao!==2) throw new Error('O administrador precisa revisar este perfil para os nove níveis de acesso da Roma.');
    const page=typeof location!=='undefined' ? String(location.pathname).split('/').pop() : '';
    if(page && page!=='login.html' && root.SistemaNavegacao && !root.SistemaNavegacao.podeAcessar(String(profile.nivelAcesso),page)) {
      if(typeof location!=='undefined') location.replace('index.html');
      throw new Error('Seu perfil não tem acesso a esta página.');
    }
    session={uid:user.uid,email:user.email,level:String(profile.nivelAcesso),name:profile.Nome||user.email};
    return profile;
  }
  function canWrite(action) {
    if(!session) return false;
    const levels={corte:['02','09'],montagem:['06','09'],edicao:['01','09'],cadastro:['01','07','08','09'],usuarios:['09'],modelos:['08','09'],planejamento:['07','08','09'],fechamento:['09'],costura:['03','09'],sola:['04','09'],palmilha:['05','09']};
    return (levels[action]||['09']).includes(session.level);
  }
  function requireWrite(action) { if(!canWrite(action)) throw new Error('Seu perfil pode consultar esta página, mas esta operação é reservada ao setor responsável e ao Admin.'); }
  function setReadOnly(elements,message) {
    elements.forEach(el=>{if(el){el.disabled=true;el.title=message||'Operação reservada ao setor responsável e ao Admin.';}});
  }
  root.Roma=Object.freeze({ROLES,SECTORS,COMPONENTS,CUT_COMPONENTS,CUT_FIELDS,LEGACY_COMPONENTS,normalizeComponents,requiresComponent,cutItemComplete,cutComplete,cutStarted,productionStarted,cutCompletionDate,stageApplicable,stageComplete,modelKey,modelKeys,assignmentPatch,validateProfile,canWrite,requireWrite,setReadOnly,get session(){return session;}});
})(typeof window!=='undefined'?window:globalThis);

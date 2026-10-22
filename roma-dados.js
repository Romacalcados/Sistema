import {doc,getDoc,runTransaction} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js';

const cache = new Map();
export function limparCacheModelos(){cache.clear();}
export async function buscarModeloOperacional(db,linha,modelo) {
  const keys=window.Roma.modelKeys(linha,modelo);
  const canonical=window.Roma.modelKey(linha,modelo);
  const matches=record=>!!canonical&&window.Roma.modelKey(record?.linha,record?.modelo)===canonical;
  for(const key of keys){
    if(!key || key.includes('/')) continue;
    if(cache.has(key)) { const cached=cache.get(key); if(matches(cached))return cached; continue; }
    const snap=await getDoc(doc(db,'modelosOperacionais',key));
    const found=snap.exists()?{...snap.data(),id:snap.id}:null;
    if(matches(found)){cache.set(key,found);return found;}
  }
  throw new Error(`Modelo ${linha}.${modelo} sem cadastro operacional. Cadastre o modelo e seus componentes em Modelos, ou publique os modelos antigos em Preparação da Roma.`);
}

export async function prepararNovoTalao(db,talao){
  window.Roma.requireWrite('cadastro');
  const modelo=await buscarModeloOperacional(db,talao.linha,talao.modelo);
  if(modelo.ativo===false)throw new Error(`Modelo ${talao.linha}.${talao.modelo} desativado.`);
  const componentes=window.Roma.normalizeComponents(modelo);
  const result={...talao,modeloId:modelo.id,componentes,statusGeral:'Pendente',statusCorte:window.Roma.CUT_COMPONENTS.some(k=>componentes[k])?'Aguardando Material':'Cortado',statusCostura:'Aguardando Material',statusMontagem:'Aguardando Material'};
  for(const campo of Object.values(window.Roma.CUT_FIELDS)){result[campo+'Concluido']=false;result[campo+'Data']='';result[campo+'Usuario']='';}
  for(const s of Object.values(window.Roma.SECTORS)){
    result[s.ownerField]='';result[s.nameField]='';result[s.originField]='';result[s.distributionField]='';
    result[s.start]='';result[s.user]='';result[s.end]='';
    if(s.key!=='costura')result[s.status]=componentes[s.key]?'Aguardando Material':'Não se aplica';
  }
  return result;
}

export async function criarTalaoSemSobrescrever(db,ref,data){
  return runTransaction(db,async tx=>{
    const existente=await tx.get(ref);
    if(existente.exists())return false;
    tx.set(ref,data);return true;
  });
}

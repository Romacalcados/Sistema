/* Planejamento da preparação de dados antigos. Nenhum perfil recebe novo nível automaticamente. */
(function(root){
  'use strict';
  function normalize(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase('pt-BR');}
  function fingerprint(data){
    function ordered(v){if(v===null||typeof v!=='object')return v;if(Array.isArray(v))return v.map(ordered);return Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])]));}
    return JSON.stringify(ordered(data));
  }
  function started(t){return root.Roma.productionStarted(t);}
  function validComponents(t){return !!t.componentes&&root.Roma.COMPONENTS.every(k=>typeof t.componentes[k]==='boolean');}
  function plan({users,models,taloes,refreshPending=false}){
    const directories=[],issues=[],modelPlans=[],talaoPlans=[];
    for(const u of users){
      const p=u.data;
      if(p.permissoesVersao!==2||!p.uid||typeof p.ativo!=='boolean'||!root.Roma.ROLES[p.nivelAcesso]){issues.push(`Usuário ${u.id}: revise o perfil e o UID em Cadastro de Usuários.`);continue;}
      const sector=Object.values(root.Roma.SECTORS).find(s=>s.level===p.nivelAcesso);
      if(sector)directories.push({id:p.uid,profileId:u.id,before:p,data:{nome:p.Nome||u.id,setor:sector.key,nivelAcesso:p.nivelAcesso,ativo:p.ativo!==false}});
    }
    const byKey=new Map();
    for(const m of models){
      modelPlans.push(m);
      const key=root.Roma.modelKey(m.data.linha,m.data.modelo);
      if(key){if(!byKey.has(key))byKey.set(key,m);else if(byKey.get(key)?.id!==m.id)byKey.set(key,null);}
    }
    for(const item of taloes){
      const t=item.data,patch={};
      const key=root.Roma.modelKey(t.linha,t.modelo);
      const model=(key&&t.modeloId&&models.find(m=>m.id===t.modeloId&&root.Roma.modelKey(m.data.linha,m.data.modelo)===key))||byKey.get(key);
      const inProgress=started(t);
      if(!validComponents(t)||refreshPending&&!inProgress){
        patch.componentes=!inProgress&&model?root.Roma.normalizeComponents(model.data):root.Roma.normalizeComponents(t);
        if(!inProgress&&model)patch.modeloId=model.id;
        if(!inProgress)patch.statusCorte=root.Roma.CUT_COMPONENTS.some(k=>patch.componentes[k])?'Aguardando Material':'Cortado';
      }
      if(model&&!t.modeloId)patch.modeloId=model.id;
      if(!model)issues.push(`Talão ${t.numeroRemessa||''}/${t.numeroTalaoSequencial||item.id}: modelo sem correspondência única; confira Modelos.`);
      const next={...t,...patch};
      for(const s of Object.values(root.Roma.SECTORS)){
        if(s.key!=='costura'&&(!t[s.status]||!inProgress&&patch.componentes))patch[s.status]=root.Roma.stageApplicable(next,s.key)?'Aguardando Material':'Não se aplica';
        if(!root.Roma.stageApplicable(next,s.key))continue;
        const existingId=t[s.ownerField]||'';
        const valid=directories.filter(d=>d.data.setor===s.key&&d.data.ativo);
        if(existingId){
          const directory=valid.find(d=>d.id===existingId);
          if(directory&&t[s.nameField]!==directory.data.nome)patch[s.nameField]=directory.data.nome;
          continue;
        }
        const legacyName=t[s.nameField];
        if(!legacyName)continue;
        const matches=valid.filter(d=>normalize(d.data.nome)===normalize(legacyName));
        if(matches.length===1)Object.assign(patch,root.Roma.assignmentPatch(s.key,{id:matches[0].id,...matches[0].data},'migracao'));
        else issues.push(`Talão ${t.numeroRemessa||''}/${t.numeroTalaoSequencial||item.id}: ateliê ${legacyName} (${s.name}) ${matches.length?'ambíguo':'sem cadastro ativo revisado'}. Defina o responsável no Corte.`);
      }
      for(const key of Object.keys(patch)){if(fingerprint(patch[key])===fingerprint(t[key]))delete patch[key];}
      if(Object.keys(patch).length){
        const ateliers=directories.filter(d=>Object.values(root.Roma.SECTORS).some(s=>(Object.hasOwn(patch,s.ownerField)||Object.hasOwn(patch,s.nameField))&&(patch[s.ownerField]||t[s.ownerField])===d.id));
        const dependencies={model:model?{id:model.id,data:{...model.data,componentes:root.Roma.normalizeComponents(model.data)}}:null,ateliers};
        talaoPlans.push({...item,patch,dependencies});
      }
    }
    return {directories,modelPlans,talaoPlans,issues:[...new Set(issues)]};
  }
  root.RomaPreparacao=Object.freeze({plan,fingerprint,started,validComponents});
})(typeof window!=='undefined'?window:globalThis);

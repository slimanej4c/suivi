const labels = {
  dashboard:['Tableau de bord','◫'], clients:['Clients','◎'], projects:['Projets','▣'],
  actions:['Plans d’action','✓'], notes:['Notes et réserves','▤'], access:['Accès techniques','◇'], tests:['Tests','⚗'],
};
const singular = {clients:'Client',projects:'Projet',actions:'Action',notes:'Note ou réserve',access:'Accès technique',tests:'Test'};
const hosting = ['Serveur du client','Notre serveur','Fournisseur externe','À confirmer'];
const schemas = {
  clients:[['name','Nom'],['email','Adresse courriel','email'],['phone','Téléphone','tel'],['website','Site web','url'],['description','Informations et contacts','textarea']],
  projects:[['name','Nom'],['status','Statut',['À planifier','En cours','En attente','Terminé']],['website','Site web','url'],['hosting','Hébergement',hosting],['date','Échéance','date'],['description','Objectifs et informations','textarea']],
  actions:[['name','Titre'],['status','Statut',['À faire','En cours','Bloqué','Terminé']],['date','Échéance','date'],['assignee','Responsable'],['priority','Priorité',['Normale','Haute','Basse']],['description','Détails et prochaine étape','textarea']],
  notes:[['name','Titre'],['type','Type',['Note','Remarque','Réserve','Décision']],['date','Date','date'],['description','Contenu','textarea']],
  access:[['name','Service ou serveur'],['type','Type',['Administration web','Hébergement','SSH / SFTP','DNS','Base de données','Autre']],['hosting','Emplacement',hosting],['url','Lien de connexion','url'],['username','Identifiant'],['reference','Référence dans un gestionnaire de mots de passe'],['description','Informations sur l’accès','textarea']],
  tests:[['name','Scénario'],['status','Résultat',['À tester','Réussi','Échoué','Bloqué']],['date','Date du test','date'],['environment','Environnement',['Local','Préproduction','Production']],['expected','Étapes et résultat attendu','textarea'],['description','Résultat observé et correctifs','textarea']],
};
const $ = selector => document.querySelector(selector);
const main = $('#main');
const search = $('#search');
const editor = $('#editor');
const form = $('#editor-form');
const reveal = $('#reveal');
const revealForm = $('#reveal-form');
let records = [];
let ready = false;
let editing;
let revealing;
let toastTimer;
let clientFilter = '';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const find = id => records.find(record => record.id === id);
const list = kind => records.filter(record => record.kind === kind);
const isOpen = record => !['Terminé','Réussi'].includes(record.status);
const date = value => {
  const parsed = new Date(value + 'T12:00:00');
  return Number.isNaN(+parsed) ? esc(value) : new Intl.DateTimeFormat('fr-CA',{dateStyle:'medium',timeZone:'America/Toronto'}).format(parsed);
};
const route = (kind, id='', tab='') => '#' + [kind,id,tab].filter(Boolean).join('/');
function urlLink(url, label) {
  try {
    const parsed = new URL(url);
    if (['http:','https:'].includes(parsed.protocol)) {
      return '<a href="'+esc(parsed.href)+'" target="_blank" rel="noopener noreferrer">'+esc(label || url)+'</a>';
    }
  } catch {}
  return '';
}
function button(label, action, value, style='secondary') {
  return '<button type="button" class="'+style+'" data-'+action+'="'+esc(value)+'">'+esc(label)+'</button>';
}
function badge(value) {
  if (!value) return '';
  const style = ['Terminé','Réussi'].includes(value) ? ' done' : ['Bloqué','Échoué','Réserve','Haute'].includes(value) ? ' alert' : '';
  return '<span class="badge'+style+'">'+esc(value)+'</span>';
}
function toast(message) {
  $('#toast').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').textContent = ''; },4000);
}
async function request(path='', options) {
  const response = await fetch('/api/records'+path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Une erreur est survenue. Réessayez.');
  return data;
}
function heading(title, description, tools='') {
  return '<div class="heading"><div><h1>'+esc(title)+'</h1>'+(description ? '<p>'+esc(description)+'</p>' : '')+'</div><div class="row-actions">'+tools+'</div></div>';
}
function panel(title, subtitle, body, link='') {
  return '<section class="panel"><div class="panel-head"><div><h2>'+esc(title)+'</h2>'+(subtitle ? '<p>'+esc(subtitle)+'</p>' : '')+'</div>'+link+'</div>'+body+'</section>';
}
function rows(items, empty, summary=false) {
  if (!items.length) return '<div class="empty"><p>'+esc(empty)+'</p></div>';
  return '<ul class="rows">'+items.map(record => {
    const {id,kind,name,status,type,description,parent,secret} = record;
    const parentRecord = find(parent);
    const linked = ['clients','projects'].includes(kind);
    const nameHtml = linked ? '<a href="'+route(kind,id)+'">'+esc(name)+'</a>' : '<strong>'+esc(name)+'</strong>';
    const details = [
      parentRecord ? esc(parentRecord.name) : '',
      record.date ? date(record.date) : '',
      esc(record.hosting),esc(record.environment),esc(record.assignee),esc(record.email),esc(record.phone),
    ].filter(Boolean).join(' · ');
    const controls = summary
      ? (linked ? '<a class="secondary" href="'+route(kind,id)+'">Ouvrir</a>' : '<a class="secondary" href="'+route('projects',parent,kind)+'">Ouvrir</a>')
      : (secret ? button('Déverrouiller','reveal',id) : '')+button('Modifier','edit',id)+button('Supprimer','remove',id,'icon danger');
    return '<li class="row"><div><div class="row-title">'+nameHtml+badge(status || type)+badge(record.priority === 'Haute' ? 'Haute' : '')+'</div>'+
      (details ? '<p>'+details+'</p>' : '')+
      (!summary ? [
        urlLink(record.website,'Ouvrir le site'),urlLink(record.url,'Ouvrir la connexion'),
        record.username ? 'Identifiant · '+esc(record.username) : '',
        record.reference ? 'Référence · '+esc(record.reference) : '',
        record.expected ? 'Attendu · '+esc(record.expected) : '',
        secret ? 'Mot de passe chiffré' : '',esc(description),
      ].filter(Boolean).map(value => '<p>'+value+'</p>').join('') : '')+
      '</div><div class="row-actions">'+controls+'</div></li>';
  }).join('')+'</ul>';
}
function dashboard() {
  const metrics = [
    ['clients','Clients',list('clients').length],['projects','Projets ouverts',list('projects').filter(isOpen).length],
    ['actions','Actions ouvertes',list('actions').filter(isOpen).length],['tests','Tests à traiter',list('tests').filter(isOpen).length],
  ];
  const next = list('actions').filter(isOpen).sort((a,b) => (a.date || '9999').localeCompare(b.date || '9999')).slice(0,4);
  return heading('Tableau de bord','Retrouvez vos dossiers et les prochaines étapes.',button('+ Nouveau projet','new','projects','primary'))+
    '<section class="hero"><p class="eyebrow">CARNET PROJETS</p><h2>Votre suivi client, au même endroit.</h2><p>Regroupez les décisions, les accès et le travail à venir dans chaque dossier client.</p>'+
    '<a class="secondary" href="#clients">Voir les clients →</a></section>'+
    '<div class="stats">'+metrics.map(([kind,label,count]) => '<a class="stat" href="'+route(kind)+'"><span class="symbol" aria-hidden="true">'+labels[kind][1]+'</span><strong>'+count+'</strong><small>'+label+'</small></a>').join('')+'</div>'+
    '<div class="board">'+panel('Projets récents','Derniers dossiers mis à jour',rows(list('projects').slice(0,4),'Créez un client, puis ajoutez son premier projet.',true),'<a href="#projects">Tous les projets →</a>')+
    panel('Prochaines actions','Classées par échéance',rows(next,'Aucune action ouverte.',true),'<a href="#actions">Toutes les actions →</a>')+'</div>';
}
function details(record, tab) {
  const {kind,id,name,parent} = record;
  const client = kind === 'clients' ? record : find(parent);
  const tags = [record.email,record.phone,record.hosting,record.date ? 'Échéance · '+date(record.date) : ''].filter(Boolean);
  const info = '<div class="details">'+tags.map(value=>'<span>'+esc(value)+'</span>').join('')+urlLink(record.website,'Ouvrir le site')+'</div>';
  const top = heading(name,kind === 'projects' ? (client?.name || '')+' · '+record.status : 'Dossier client',button('Modifier la fiche','edit',id));
  const description = record.description ? '<p class="description">'+esc(record.description)+'</p>' : '';
  if (kind === 'clients') {
    return top+info+description+panel('Projets du client','',rows(list('projects').filter(project=>project.parent===id),'Aucun projet pour ce client.'),button('+ Projet','new','projects:'+id,'primary'));
  }
  const tabs = ['actions','notes','access','tests'];
  const selected = tabs.includes(tab) ? tab : 'actions';
  return top+info+description+'<div class="tabs" aria-label="Sections du projet">'+tabs.map(key=>'<a href="'+route('projects',id,key)+'"'+(key===selected?' aria-current="page"':'')+'>'+labels[key][0]+'</a>').join('')+'</div>'+
    panel(labels[selected][0],'',rows(list(selected).filter(item=>item.parent===id),'Aucun élément dans cette section.'),button('+ Ajouter','new',selected+':'+id,'primary'));
}
function render() {
  const [raw='dashboard',id,tab] = location.hash.slice(1).split('/');
  const view = Object.hasOwn(labels,raw) ? raw : 'dashboard';
  const current = find(id);
  $('#nav').innerHTML = Object.entries(labels).map(([key,[label,glyph]])=>'<a href="'+route(key)+'"'+(view===key?' aria-current="page"':'')+'><span class="glyph" aria-hidden="true">'+glyph+'</span>'+label+'</a>').join('');
  $('#crumb').innerHTML = '<a href="#dashboard">Espace de travail</a> &nbsp;/&nbsp; <strong>'+labels[view][0]+'</strong>';
  if (!ready) return;
  const query = search.value.trim().toLocaleLowerCase('fr');
  if (query) {
    const results = records.filter(record => Object.entries(record).some(([key,value]) => !['secret','id','kind','parent','updated'].includes(key) && value.toLocaleLowerCase('fr').includes(query)));
    main.innerHTML = heading('Résultats de recherche',results.length+' fiche(s) trouvée(s)')+panel('Correspondances','',rows(results,'Aucun résultat pour cette recherche.'));
  } else if (view === 'dashboard') {
    main.innerHTML = dashboard();
  } else if (id && ['clients','projects'].includes(view)) {
    main.innerHTML = current?.kind === view ? details(current,tab) : heading('Fiche introuvable','Ce dossier a peut-être été supprimé.');
  } else {
    const filters = view === 'clients' ? '' : '<div class="filters"><label>Client <select id="client-filter"><option value="">Tous les clients</option>'+list('clients').map(record=>'<option value="'+record.id+'"'+(record.id===clientFilter?' selected':'')+'>'+esc(record.name)+'</option>').join('')+'</select></label></div>';
    const items = list(view).filter(record=>!clientFilter || view==='clients' || (view==='projects'?record.parent:find(record.parent)?.parent)===clientFilter);
    main.innerHTML = heading(labels[view][0],items.length+' fiche(s)',button('+ Ajouter','new',view,'primary'))+filters+panel('Toutes les fiches','',rows(items,'Aucune fiche dans cette section.'));
  }
}
function field([key,label,type='text'], value, required=false) {
  const attrs = ' name="'+key+'"'+(required?' required':'');
  let input;
  if (Array.isArray(type)) {
    input = '<select'+attrs+'>'+type.map(option=>'<option'+(value===option?' selected':'')+'>'+esc(option)+'</option>').join('')+'</select>';
  } else if (type === 'textarea') {
    input = '<textarea'+attrs+ ' maxlength="8000">'+esc(value)+'</textarea>';
  } else {
    input = '<input'+attrs+' type="'+type+'" value="'+esc(value)+'" maxlength="'+(key==='name'?160:8000)+'">';
  }
  return '<label>'+esc(label)+input+'</label>';
}
function openEditor(kind, parent='', original) {
  const parentKind = kind === 'clients' ? null : kind === 'projects' ? 'clients' : 'projects';
  const parents = parentKind ? list(parentKind) : [];
  if (parentKind && !parents.length) {
    toast(kind === 'projects' ? 'Ajoutez d’abord un client.' : 'Ajoutez d’abord un projet.');
    if (kind === 'projects') openEditor('clients');
    return;
  }
  editing = {kind,id:original?.id ?? crypto.randomUUID(),original};
  $('#editor-title').textContent = original ? 'Modifier · '+singular[kind] : 'Ajouter · '+singular[kind];
  $('#form-error').textContent = '';
  const selected = original?.parent || parent || (kind==='projects'?clientFilter:'');
  const parentField = parentKind ? '<label>'+singular[parentKind]+'<select name="parent" required>'+parents.map(item => '<option value="'+item.id+'"'+(item.id===selected?' selected':'')+'>'+esc(item.name)+(parentKind==='projects'?' · '+esc(find(item.parent)?.name):'')+'</option>').join('')+'</select></label>' : '';
  const secretFields = kind === 'access' ? '<label>Mot de passe'+
    '<input name="password" type="password" autocomplete="new-password" maxlength="2048" placeholder="'+(original?.secret?'Laisser vide pour conserver':'Facultatif')+'"></label>'+
    '<label id="phrase-field" hidden>Phrase secrète de chiffrement<input name="phrase" type="password" autocomplete="new-password" minlength="14" maxlength="256"><small>Choisissez au moins 14 caractères. Gardez cette phrase pour déverrouiller le mot de passe. Elle ne peut pas être récupérée.</small></label>'+
    (original?.secret?'<label>Retirer le mot de passe enregistré <input type="checkbox" name="clearSecret"></label>':'') : '';
  $('#fields').innerHTML = parentField+schemas[kind].map(config=>field(config,original?.[config[0]],config[0]==='name')).join('')+secretFields;
  editor.showModal();
}
const encode = new TextEncoder();
const base64 = bytes => btoa(String.fromCharCode(...bytes));
const unbase64 = text => Uint8Array.from(atob(text), character=>character.charCodeAt(0));
async function keyFor(phrase,salt) {
  const material = await crypto.subtle.importKey('raw',encode.encode(phrase),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:600000,salt},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encrypt(password,phrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(phrase,salt);
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encode.encode(password));
  return ['v1',base64(salt),base64(iv),base64(new Uint8Array(cipher))].join('.');
}
form.addEventListener('input', event => {
  if (event.target.name !== 'password') return;
  const field = $('#phrase-field');
  field.hidden = !event.target.value;
  field.querySelector('input').required = !field.hidden;
});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const {kind,id,original} = editing;
  const input = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  $('#form-error').textContent = '';
  try {
    if (kind === 'access') {
      input.secret = input.password ? await encrypt(input.password,input.phrase) : input.clearSecret ? '' : original?.secret || '';
      delete input.password;
      delete input.phrase;
      delete input.clearSecret;
    }
    const record = await request('/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,kind,updated:original?.updated})});
    records = [record,...records.filter(item=>item.id!==id)];
    editor.close();
    search.value = '';
    if (!original && ['clients','projects'].includes(kind)) location.hash = route(kind,id);
    else render();
    toast('Fiche enregistrée.');
  } catch(error) { $('#form-error').textContent = error.message; }
  finally { submit.disabled = false; }
});
revealForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const submit = revealForm.querySelector('[type=submit]');
  submit.disabled = true;
  $('#reveal-error').textContent = '';
  revealForm.elements.value.value = '';
  try {
    const [,salt,iv,cipher] = revealing.split('.').map((part,index)=>index ? unbase64(part) : part);
    const key = await keyFor(revealForm.elements.phrase.value,salt);
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv},key,cipher);
    if (reveal.open) revealForm.elements.value.value = new TextDecoder().decode(plain);
  } catch { if (reveal.open) $('#reveal-error').textContent = 'Phrase secrète incorrecte ou mot de passe illisible.'; }
  finally { revealForm.elements.phrase.value = ''; submit.disabled = false; }
});
document.addEventListener('click',async event=>{
  const control = event.target.closest('button');
  if (!control) return;
  const {dataset} = control;
  if ('close' in dataset) control.closest('dialog').close();
  if (dataset.new) openEditor(...dataset.new.split(':'));
  if (dataset.edit) {
    const record = find(dataset.edit);
    if (record) openEditor(record.kind,record.parent,record);
  }
  if (dataset.reveal) {
    revealing = find(dataset.reveal)?.secret;
    if (revealing) reveal.showModal();
  }
  if (dataset.remove) {
    const record = find(dataset.remove);
    if (!record || !confirm('Supprimer « '+record.name+' » ?')) return;
    control.disabled = true;
    try {
      await request('/'+record.id,{method:'DELETE'});
      records = records.filter(item=>item.id!==record.id);
      render();
      toast('Fiche supprimée.');
    } catch(error) { toast(error.message); control.disabled = false; }
  }
});
editor.addEventListener('cancel', event=>{ if (form.querySelector('[type=submit]').disabled) event.preventDefault(); });
editor.addEventListener('close',()=>{ form.reset(); $('#fields').replaceChildren(); });
reveal.addEventListener('close',()=>{ revealForm.reset(); $('#reveal-error').textContent=''; revealing=''; });
document.addEventListener('change',event=>{
  if (event.target.id === 'client-filter') { clientFilter = event.target.value; render(); }
});
search.addEventListener('input',render);
window.addEventListener('hashchange',()=>{ search.value=''; render(); main.focus(); });
render();
request().then(data=>{ records=data; ready=true; render(); }).catch(error=>{
  main.innerHTML=heading('Carnet indisponible',error.message)+'<a class="secondary" href="/">Réessayer</a>';
});

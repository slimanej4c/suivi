const labels = {
  dashboard:['Tableau de bord','◫'], clients:['Clients','◎'], projects:['Projets','▣'],
  actions:['Plans d’action','✓'], notes:['Notes et réserves','▤'], access:['Serveur','◇'], tests:['Tests','⚗'],
};
const commandType = 'Commande';
const serviceTypes = {commands:commandType,github:'GitHub',api:'Clé API',stripe:'Stripe',firebase:'Firebase',supabase:'Supabase',mysql:'MySQL'};
for (const [section,type] of Object.entries(serviceTypes)) {
  labels[section] = [section === 'api' ? 'API' : section === 'commands' ? 'Commandes' : type, section === 'commands' ? '›_' : '◇'];
}
const singular = {clients:'Client',projects:'Projet',actions:'Action',notes:'Note ou réserve',access:'Accès technique',tests:'Test'};
const hosting = ['Serveur du client','Notre serveur','Fournisseur externe','À confirmer'];
const schemas = {
  clients:[['name','Nom'],['email','Adresse courriel','email'],['phone','Téléphone','tel'],['website','Site web','url'],['description','Informations et contacts','textarea']],
  projects:[['name','Nom'],['status','Statut',['À planifier','En cours','En attente','Terminé']],['website','Site web','url'],['hosting','Hébergement',hosting],['date','Échéance','date'],['description','Objectifs et informations','textarea']],
  actions:[['name','Titre'],['status','Statut',['À faire','En cours','Bloqué','Terminé']],['date','Échéance','date'],['assignee','Responsable'],['priority','Priorité',['Normale','Haute','Basse']],['description','Détails et prochaine étape','textarea']],
  notes:[['name','Titre'],['type','Type',['Note','Remarque','Réserve','Décision']],['date','Date','date'],['description','Contenu','textarea']],
  access:[
    ['name','Nom de l’accès'],
    ['type','Type',['GitHub','Clé API','Stripe','Firebase','Supabase','MySQL','Connexion à un site','SSH / SFTP','Administration web','Hébergement','DNS','Base de données','Autre']],
    ['environment','Environnement',['À préciser','Local','Préproduction','Production','Commun']],
    ['hosting','Propriétaire du serveur',hosting],
    ['url','URL du dépôt, du site ou de l’API','url'],
    ['username','Compte ou identifiant'],
    ['host','Hôte ou adresse du serveur'],
    ['branch','Branche Git'],
    ['path','Chemin du projet sur la machine'],
    ['reference','Référence ou lien vers votre gestionnaire de mots de passe'],
    ['commands','Commandes utiles','textarea'],
    ['description','Instructions et informations sur l’accès','textarea'],
  ],
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
let csrf;
let editing;
let revealing;
let toastTimer;
let activeProject;
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
  const headers = new Headers(options?.headers);
  if (options?.method) headers.set('X-CSRF-Token', csrf);
  const response = await fetch('/api/records'+path, {...options, headers});
  if (response.status === 401) location.assign('/connexion');
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
    const accessLink = record.type === 'GitHub' ? 'Ouvrir le dépôt' : 'Ouvrir la connexion';
    const controls = summary
      ? (linked ? '<a class="secondary" href="'+route(kind,id)+'">Ouvrir</a>' : '<a class="secondary" href="'+route('projects',parent,kind)+'">Ouvrir</a>')
      : (secret ? button('Déverrouiller','reveal',id) : '')+button('Modifier','edit',id)+button('Supprimer','remove',id,'icon danger');
    return '<li class="row"><div><div class="row-title">'+nameHtml+badge(status || type)+badge(record.priority === 'Haute' ? 'Haute' : '')+'</div>'+
      (details ? '<p>'+details+'</p>' : '')+
      (!summary ? [
        urlLink(record.website,'Ouvrir le site'),urlLink(record.url,accessLink),
        record.host ? 'Hôte · '+esc(record.host) : '',
        record.branch ? 'Branche · '+esc(record.branch) : '',
        record.path ? 'Dossier · '+esc(record.path) : '',
        record.username ? 'Identifiant · '+esc(record.username) : '',
        record.reference ? 'Référence · '+esc(record.reference) : '',
        record.expected ? 'Attendu · '+esc(record.expected) : '',
        secret ? 'Identifiant secret chiffré' : '',esc(description),
      ].filter(Boolean).map(value => '<p>'+value+'</p>').join('') : '')+
      (!summary && kind === 'access' && record.commands
        ? '<details class="commands"'+(type === commandType ? ' open' : '')+'><summary>Commandes enregistrées</summary><pre>'+esc(record.commands)+'</pre>'+
          button('Copier les commandes','copy',id)+'</details>' : '')+
      (!summary && kind === 'access' ? accessLines(record).map(({label,value},index) =>
        '<details class="commands"><summary>'+esc(label)+'</summary><pre>'+esc(value)+'</pre>'+
        button('Copier','copy-line',id+':'+index)+'</details>').join('') : '')+
      '</div><div class="row-actions">'+controls+'</div></li>';
  }).join('')+'</ul>';
}
const projectSections = ['dashboard','actions','notes','access',...Object.keys(serviceTypes),'tests'];
const projectHref = (id, section='dashboard') => route('projects',id,section);
const testAccountType = 'Compte de test';
function serviceSection(record) {
  if (record.type === testAccountType) return 'testAccounts';
  return Object.keys(serviceTypes).find(section => serviceTypes[section] === record.type) ?? 'access';
}
function projectItems(project, section) {
  const isAccess = section === 'access' || section === 'testAccounts' || Object.hasOwn(serviceTypes,section);
  return list(isAccess ? 'access' : section).filter(record =>
    record.parent === project.id && (!isAccess || serviceSection(record) === section));
}
function accessLines(record) {
  try {
    const lines = JSON.parse(record?.lines || '[]');
    return Array.isArray(lines) ? lines.filter(line => typeof line?.label === 'string' && typeof line.value === 'string') : [];
  } catch { return []; }
}
function lineField(line = {label:'',value:''}) {
  return '<div class="access-line"><label>Titre de la ligne<input name="lineTitle" maxlength="160" placeholder="Ex. Mise à jour en production" value="'+esc(line.label)+'"></label>'+
    '<label>Contenu<textarea name="lineValue" maxlength="8000">'+esc(line.value)+'</textarea></label>'+
    '<button type="button" class="secondary" data-remove-line>Retirer la ligne</button></div>';
}
const keyTypes = ['Clé API','Stripe','Firebase','Supabase'];


function projectDashboard(project) {
  const actions = projectItems(project,'actions').filter(isOpen);
  const next = actions.sort((a,b) => (a.date || '9999').localeCompare(b.date || '9999')).slice(0,4);
  const metrics = [
    ['actions','Actions ouvertes',actions.length],
    ['notes','Notes et réserves',projectItems(project,'notes').length],
    ['access','Serveurs et connexions',projectItems(project,'access').length],
    ['tests','Tests à traiter',projectItems(project,'tests').filter(isOpen).length],
  ];
  const client = find(project.parent);
  const info = [
    client ? '<span>'+esc(client.name)+'</span>' : '',
    project.hosting ? '<span>'+esc(project.hosting)+'</span>' : '',
    project.date ? '<span>Échéance · '+date(project.date)+'</span>' : '',
    urlLink(project.website,'Ouvrir le site'),
  ].filter(Boolean).join('');
  return heading(project.name,project.status,button('Modifier le projet','edit',project.id))+
    (info ? '<div class="details">'+info+'</div>' : '')+
    (project.description ? '<p class="description">'+esc(project.description)+'</p>' : '')+
    '<div class="stats">'+metrics.map(([kind,label,count]) => '<a class="stat" href="'+projectHref(project.id,kind)+'"><span class="symbol" aria-hidden="true">'+labels[kind][1]+'</span><strong>'+count+'</strong><small>'+label+'</small></a>').join('')+'</div>'+
    panel('Prochaines actions','Classées par échéance',rows(next,'Aucune action ouverte.',true),'<a href="'+projectHref(project.id,'actions')+'">Toutes les actions →</a>');
}

function projectPicker(items, empty) {
  if (!items.length) return panel('Projets','',rows([],empty));
  return '<div class="project-grid">'+items.map(project =>
    '<a class="project-card panel" href="'+projectHref(project.id)+'"><span class="project-icon" aria-hidden="true">▣</span>'+
    '<h2>'+esc(project.name)+'</h2><p>'+esc(find(project.parent)?.name)+'</p><div>'+badge(project.status)+'<span class="open-project">Ouvrir →</span></div></a>'
  ).join('')+'</div>';
}

function navLink(kind, href, current) {
  return '<a href="'+href+'"'+(current?' aria-current="page"':'')+'><span class="glyph" aria-hidden="true">'+labels[kind][1]+'</span>'+labels[kind][0]+'</a>';
}

function matches(record, query) {
  return Object.entries(record).some(([key,value]) =>
    !['secret','id','kind','parent','updated'].includes(key) && String(value ?? '').toLocaleLowerCase('fr').includes(query));
}

function render() {
  if (!ready) return;
  const [view,id,tab] = location.hash.slice(1).split('/');
  const project = view === 'projects' && id && find(id)?.kind === 'projects' ? find(id) : null;
  const section = projectSections.includes(tab) ? tab : 'dashboard';
  activeProject = project;
  const clientView = view === 'clients' && !project;
  const query = search.value.trim().toLocaleLowerCase('fr');
  $('#nav').innerHTML = project
    ? '<a class="back-projects" href="#projects">← Tous les projets</a><div class="active-project">'+esc(project.name)+'</div>'+
      projectSections.map(kind => navLink(kind,projectHref(project.id,kind),kind===section)).join('')
    : navLink('projects','#projects',!clientView)+navLink('clients','#clients',clientView);
  $('#crumb').innerHTML = project
    ? '<a href="#projects">Projets</a> / <strong>'+esc(project.name)+'</strong>'+(section==='dashboard'?'':' / '+labels[section][0])
    : '<strong>'+(clientView?'Clients':'Projets')+'</strong>';
  search.placeholder = project ? 'Rechercher dans ce projet…' : clientView ? 'Rechercher un client…' : 'Rechercher un projet…';
  search.setAttribute('aria-label',search.placeholder.slice(0,-1));
  document.title = (project ? project.name : clientView ? 'Clients' : 'Projets')+' · Carnet Projets';

  if (project && query) {
    const results = records.filter(record => record.parent === project.id && matches(record,query));
    main.innerHTML = heading('Recherche dans '+project.name,results.length+' résultat(s)')+
      panel('Correspondances','',rows(results,'Aucun résultat dans ce projet.'));
  } else if (project) {
    main.innerHTML = section === 'dashboard' ? projectDashboard(project) :
      heading(labels[section][0],project.name,section === 'access'
        ? button('+ Serveur','new','access:'+project.id+':SSH / SFTP','primary')+
          button('+ Connexion à un site','new','access:'+project.id+':Connexion à un site')
        : Object.hasOwn(serviceTypes,section)
          ? button(section === 'commands' ? '+ Commande' : '+ Ajouter','new','access:'+project.id+':'+serviceTypes[section],'primary')
          : button('+ Ajouter','new',section+':'+project.id,'primary'))+
      panel(labels[section][0],'',rows(projectItems(project,section),'Aucun élément dans cette section.'))+
      (section === 'actions' ? '<div class="test-accounts">'+
        panel('Comptes de test','',rows(projectItems(project,'testAccounts'),'Aucun compte de test.'),
          button('+ Compte de test','new','access:'+project.id+':'+testAccountType))+'</div>' : '');
  } else if (clientView) {
    const client = find(id);
    main.innerHTML = client?.kind === 'clients' && !query
      ? heading(client.name,'Dossier client',button('Modifier la fiche','edit',client.id)+button('+ Nouveau projet','new','projects:'+client.id,'primary'))+
        '<div class="details">'+[client.email,client.phone].filter(Boolean).map(value=>'<span>'+esc(value)+'</span>').join('')+urlLink(client.website,'Ouvrir le site')+'</div>'+
        (client.description?'<p class="description">'+esc(client.description)+'</p>':'')+
        projectPicker(list('projects').filter(item=>item.parent===client.id),'Aucun projet pour ce client.')
      : heading('Clients','Retrouvez les dossiers de vos clients.',button('+ Nouveau client','new','clients','primary'))+
        panel('Clients','',rows(list('clients').filter(item=>matches(item,query)),'Aucun client trouvé.'));
  } else {
    main.innerHTML = heading('Vos projets','Choisissez un projet pour ouvrir son espace de travail.',button('+ Nouveau projet','new','projects','primary'))+
      projectPicker(list('projects').filter(item=>matches(item,query) || matches(find(item.parent) ?? {},query)),
        query ? 'Aucun projet trouvé.' : 'Ajoutez un client, puis créez votre premier projet.');
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
function openEditor(kind, parent='', original, accessType) {
  const parentKind = kind === 'clients' ? null : kind === 'projects' ? 'clients' : 'projects';
  const fixedProject = parentKind === 'projects' ? activeProject : null;
  const parents = fixedProject ? [fixedProject] : parentKind ? list(parentKind) : [];
  if (parentKind && !parents.length) {
    toast(kind === 'projects' ? 'Ajoutez d’abord un client.' : 'Ajoutez d’abord un projet.');
    if (kind === 'projects') openEditor('clients');
    return;
  }
  editing = {kind,id:original?.id ?? crypto.randomUUID(),original};
  const isTestAccount = (original?.type ?? accessType) === testAccountType;
  const isCommand = kind === 'access' && (original?.type ?? accessType) === commandType;
  const title = isCommand ? commandType : isTestAccount ? testAccountType : singular[kind];
  $('#editor-title').textContent = (original ? 'Modifier · ' : 'Ajouter · ')+title;
  $('#form-error').textContent = '';
  const selected = original?.parent || parent || fixedProject?.id || '';
  const parentField = fixedProject
    ? '<input type="hidden" name="parent" value="'+fixedProject.id+'">'
    : parentKind ? '<label>'+singular[parentKind]+'<select name="parent" required>'+parents.map(item => '<option value="'+item.id+'"'+(item.id===selected?' selected':'')+'>'+esc(item.name)+(parentKind==='projects'?' · '+esc(find(item.parent)?.name):'')+'</option>').join('')+'</select></label>' : '';
  const secretFields = kind === 'access' ? '<label><span id="secret-label">Mot de passe</span>'+
    '<input name="password" type="password" autocomplete="new-password" maxlength="2048" placeholder="'+(original?.secret?'Laisser vide pour conserver':'Facultatif')+'"></label>'+
    '<label id="phrase-field" hidden>Phrase secrète de chiffrement<input name="phrase" type="password" autocomplete="new-password" minlength="14" maxlength="256"><small>Choisissez au moins 14 caractères. Gardez cette phrase pour déverrouiller la valeur enregistrée. Elle ne peut pas être récupérée.</small></label>'+
    (original?.secret?'<label>Retirer la valeur enregistrée <input type="checkbox" name="clearSecret"></label>':'') : '';
  const values = original ?? {
    type:accessType,
    date:new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Toronto'}).format(new Date()),
  };
  if (isCommand) {
    const commandFields = [
      ['name','Titre'],
      ['environment','Environnement',['À préciser','Local','Préproduction','Production','Commun']],
      ['path','Dossier de travail'],
      ['commands','Commande à copier dans le terminal','textarea'],
      ['description','Note','textarea'],
    ];
    $('#fields').innerHTML = parentField+'<input type="hidden" name="type" value="'+commandType+'">'+
      commandFields.map(config => field(config,values[config[0]],['name','commands'].includes(config[0]))).join('');
  } else if (kind === 'access') {
    const type = values.type || 'Autre';
    const basic = ['name','url','username'];
    if (isTestAccount || serviceSection({type}) === 'access') basic.push('environment');
    const configs = schemas.access.filter(([key]) => basic.includes(key));
    const extra = schemas.access.filter(([key]) => !basic.includes(key) && key !== 'type');
    const extraFields = extra.filter(([key]) => values[key]).map(config => field(config,values[config[0]])).join('');
    $('#fields').innerHTML = parentField+'<input type="hidden" name="type" value="'+esc(type)+'">'+
      configs.map(config => field(config,values[config[0]],config[0]==='name')).join('')+secretFields+
      (extraFields ? '<details><summary>Informations existantes</summary>'+extraFields+'</details>' : '')+
      '<small>Placez les mots de passe et les clés dans le champ chiffré ci-dessus.</small>'+
      '<div id="access-lines">'+accessLines(original).map(lineField).join('')+'</div>'+
      '<button type="button" class="secondary" data-add-line>+ Ajouter une ligne</button>';
  } else {
    $('#fields').innerHTML = parentField+schemas[kind].map(config =>
      field(config,values[config[0]],config[0]==='name')).join('');
  }
  if (kind === 'access' && !isCommand) updateSecretLabel();
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
function updateSecretLabel() {
  $('#secret-label').textContent = keyTypes.includes(form.elements.namedItem('type').value)
    ? 'Clé API ou jeton' : 'Mot de passe ou jeton';
  if (form.elements.namedItem('type').value === testAccountType) $('#secret-label').textContent = 'Mot de passe';
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
  const formData = new FormData(form);
  const input = Object.fromEntries(formData);
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  $('#form-error').textContent = '';
  try {
    if (input.type === commandType && kind === 'access' && !input.commands.trim()) {
      throw new Error('Saisissez une commande.');
    }
    if (kind === 'access' && input.type !== commandType) {
      const titles = formData.getAll('lineTitle');
      const lines = formData.getAll('lineValue').map((value,index) => ({
        label:titles[index].trim() || 'Note '+(index+1), value:value.trim(),
      })).filter(line => line.value);
      input.lines = JSON.stringify(lines);
      delete input.lineTitle;
      delete input.lineValue;
      input.secret = input.password ? await encrypt(input.password,input.phrase) : input.clearSecret ? '' : original?.secret || '';
      delete input.password;
      delete input.phrase;
      delete input.clearSecret;
    }
    const record = await request('/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...original,...input,kind,updated:original?.updated})});
    records = [record,...records.filter(item=>item.id!==id)];
    editor.close();
    search.value = '';
    if (!original && kind === 'projects') location.hash = projectHref(id);
    else if (!original && kind === 'clients') location.hash = route(kind,id);
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
  } catch { if (reveal.open) $('#reveal-error').textContent = 'Phrase secrète incorrecte ou valeur illisible.'; }
  finally { revealForm.elements.phrase.value = ''; submit.disabled = false; }
});
document.addEventListener('click',async event=>{
  const control = event.target.closest('button');
  if (!control) return;
  const {dataset} = control;
  if ('close' in dataset) control.closest('dialog').close();
  if (dataset.new) {
    const [kind,parent,accessType] = dataset.new.split(':');
    openEditor(kind,parent,undefined,accessType);
  }
  if ('addLine' in dataset) {
    $('#access-lines').insertAdjacentHTML('beforeend',lineField());
    $('#access-lines').lastElementChild.querySelector('input').focus();
  }
  if ('removeLine' in dataset) control.closest('.access-line').remove();
  if (dataset.copy || dataset.copyLine) {
    const [id,index] = (dataset.copyLine || dataset.copy).split(':');
    const record = find(id);
    const commands = dataset.copyLine ? accessLines(record)[index]?.value : record?.commands;
    if (!commands) return;
    try {
      await navigator.clipboard.writeText(commands);
      toast('Texte copié.');
    } catch {
      toast('Sélectionnez et copiez le texte des commandes.');
    }
  }
  if (dataset.edit) {
    const record = find(dataset.edit);
    if (record) openEditor(record.kind,record.parent,record);
  }
  if (dataset.reveal) {
    const record = find(dataset.reveal);
    revealing = record?.secret;
    if (revealing) {
      const apiKey = keyTypes.includes(record.type);
      $('#reveal-title').textContent = apiKey ? 'Déverrouiller la clé API' : 'Déverrouiller le mot de passe';
      $('#revealed-label').textContent = apiKey ? 'Clé API déchiffrée' : 'Mot de passe déchiffré';
      reveal.showModal();
    }
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
search.addEventListener('input',render);
window.addEventListener('hashchange',()=>{
  if (editor.open) editor.close();
  if (reveal.open) reveal.close();
  search.value='';
  render();
  main.focus();
});
render();
$('#logout').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/logout', {method:'POST', headers:{'X-CSRF-Token':csrf}});
    if (!response.ok) throw new Error('Impossible de fermer la session. Rechargez la page.');
    location.assign('/connexion');
  } catch(error) { toast(error.message); }
});
async function loadRecords() {
  const response = await fetch('/api/session');
  if (response.status === 401) {
    location.assign('/connexion');
    return;
  }
  if (!response.ok) throw new Error('Impossible de vérifier la session.');
  ({csrf} = await response.json());
  records = await request();
  ready = true;
  render();
}
loadRecords().catch(error=>{
  main.innerHTML=heading('Carnet indisponible',error.message)+'<a class="secondary" href="/">Réessayer</a>';
});

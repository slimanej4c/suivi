const resources = {
  clients: {fields:['name','email','phone','website','description']},
  projects: {parent:'clients', fields:['name','status','website','hosting','date','description']},
  actions: {parent:'projects', fields:['name','status','date','assignee','priority','description']},
  notes: {parent:'projects', fields:['name','type','date','description']},
  access: {parent:'projects', fields:['name','type','hosting','url','username','reference','secret','description']},
  tests: {parent:'projects', fields:['name','status','date','environment','expected','description']},
};

const headers = {
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; font-src 'self' https://fonts.gstatic.com; style-src 'self' https://fonts.googleapis.com; base-uri 'none'; form-action 'self'; object-src 'none'",
};
const json = (data, status = 200) => Response.json(data, {status, headers});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      const asset = Object.hasOwn(assets, url.pathname) && assets[url.pathname];
      return asset
        ? new Response(asset.body, {headers:{...headers,'Content-Type':asset.type+'; charset=utf-8'}})
        : new Response('Page introuvable', {status:404, headers});
    }
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) return json({error:'Connectez-vous pour accéder à votre carnet.'}, 401);
    try {
      if (request.method === 'GET' && url.pathname === '/api/records') {
        const {results} = await env.DB.prepare('SELECT id, kind, parent, data, updated FROM records WHERE owner = ? ORDER BY updated DESC').bind(owner).all();
        return json(results.map(({data,...row}) => ({...row,...JSON.parse(data)})));
      }
      const match = /^\/api\/records\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (!match) return json({error:'Adresse inconnue.'}, 404);
      const id = match[1];
      if (request.headers.get('Origin') !== url.origin) return json({error:'Origine non autorisée.'}, 403);
      if (request.method === 'DELETE') {
        const result = await env.DB.prepare(
          'DELETE FROM records WHERE owner = ? AND id = ? AND NOT EXISTS (SELECT 1 FROM records AS child WHERE child.owner = ? AND child.parent = ?)'
        ).bind(owner,id,owner,id).run();
        return result.meta.changes ? json({ok:true}) : json({error:'Retirez les éléments associés avant de supprimer cette fiche.'},409);
      }
      if (request.method !== 'PUT') return json({error:'Méthode non autorisée.'},405);
      const raw = await request.text();
      if (raw.length > 45000) return json({error:'Cette fiche est trop volumineuse.'},413);
      let input;
      try { input = JSON.parse(raw); } catch { return json({error:'Fiche invalide.'},400); }
      if (!input || !Object.hasOwn(resources,input.kind)) return json({error:'Catégorie invalide.'},400);
      const {kind} = input;
      const schema = resources[kind];
      const parent = schema.parent && typeof input.parent === 'string' ? input.parent : '';
      const data = Object.fromEntries(schema.fields.map(key => [key, typeof input[key] === 'string' ? input[key].trim() : '']));
      if (!data.name || data.name.length > 160 ||
          Object.entries(data).some(([key,value]) => value.length > (key === 'secret' ? 20000 : 8000))) {
        return json({error:'Vérifiez le nom et la longueur des champs.'},400);
      }
      if (data.secret && !/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(data.secret)) {
        return json({error:'Le mot de passe doit être chiffré.'},400);
      }
      const updated = new Date().toISOString();
      const result = await env.DB.prepare(`
        INSERT INTO records(owner,id,kind,parent,data,updated)
        SELECT ?,?,?,?,?,? WHERE ? = '' OR EXISTS (SELECT 1 FROM records WHERE owner = ? AND id = ? AND kind = ?)
        ON CONFLICT(owner,id) DO UPDATE SET parent = excluded.parent, data = excluded.data, updated = excluded.updated
        WHERE records.kind = excluded.kind AND records.updated = ?
      `).bind(owner,id,kind,parent,JSON.stringify(data),updated,schema.parent ?? '',owner,parent,schema.parent ?? '',input.updated ?? '').run();
      if (!result.meta.changes) return json({error:'La fiche a changé ou son dossier est introuvable. Actualisez la page.'},409);
      return json({id,kind,parent,updated,...data});
    } catch (error) {
      console.error('Erreur de stockage', error.name);
      return json({error:'Impossible d’accéder aux données. Réessayez.'},500);
    }
  },
};

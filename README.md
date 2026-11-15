# Carnet Projets

L'application utilise Flask, MySQL et Waitress. Les comptes sont créés par
l'administrateur. Chaque compte dispose de ses propres fiches. Les mots de passe
de connexion sont hachés, et les mots de passe d'accès technique facultatifs
sont chiffrés par le navigateur.

## Installation

1. Créer la base MySQL et appliquer le schéma avec un compte administrateur.

   ```sql
   CREATE DATABASE carnet_projets CHARACTER SET utf8mb4;
   ```

   ```sh
   mysql -u root -p carnet_projets < mysql.sql
   ```

2. Créer un utilisateur MySQL dédié avec les droits `SELECT`, `INSERT`,
   `UPDATE` et `DELETE` sur cette base. Copier `.env.example` vers `.env`,
   renseigner ses identifiants et protéger le fichier avec `chmod 600 .env`.
   Générer une valeur aléatoire pour `CARNET_SECRET_KEY` avec
   `python3 -c 'import secrets; print(secrets.token_hex(32))'`.
   Pour une base distante, configurer `CARNET_DB_CA` pour vérifier son certificat.

3. Installer les dépendances et créer un compte.

   ```sh
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   .venv/bin/flask --app app create-user vous@example.com
   ```

   La commande demande le mot de passe et sa confirmation. Utiliser la même
   commande pour ajouter d'autres comptes.

## Démarrage

Sur le Mac, le fichier `.env` local active `CARNET_LOCAL_HTTP=1`.
Démarrer le serveur et ouvrir <http://127.0.0.1:8765/>.

```sh
.venv/bin/waitress-serve --listen=127.0.0.1:8765 app:app
```

Pour publier, déployer le code sur un hôte Python et placer Waitress derrière un
proxy HTTPS. Laisser `CARNET_LOCAL_HTTP` absent pour activer les cookies sécurisés.
L'ancienne application Sites utilise un runtime et une base distincts. Les fiches
de cette ancienne adresse ne sont pas copiées automatiquement vers MySQL.

import hashlib
import hmac
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

import click
import mysql.connector
from dotenv import load_dotenv
from flask import Flask, g, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from mysql.connector import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ["CARNET_SECRET_KEY"],
    SESSION_COOKIE_NAME="carnet_form",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
    SESSION_COOKIE_SECURE=os.getenv("CARNET_LOCAL_HTTP") != "1",
    MAX_CONTENT_LENGTH=128 * 1024,
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
)
if len(app.secret_key) < 32:
    raise RuntimeError("CARNET_SECRET_KEY doit contenir au moins 32 caractères.")

RESOURCES = {
    "clients": (None, "name email phone website description"),
    "projects": ("clients", "name status website hosting date description"),
    "actions": ("projects", "name status date assignee priority description"),
    "notes": ("projects", "name type date description"),
    "access": ("projects", "name type hosting environment url username host branch path reference commands secret description lines"),
    "tests": ("projects", "name status date environment expected description"),
}
RECORD_ID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
TOKEN_COOKIE = "carnet_session"
DUMMY_HASH = generate_password_hash(secrets.token_hex(32))


def db():
    if "db" not in g:
        ca = os.getenv("CARNET_DB_CA")
        g.db = mysql.connector.connect(
            host=os.getenv("CARNET_DB_HOST", "127.0.0.1"),
            port=int(os.getenv("CARNET_DB_PORT", "3306")),
            user=os.getenv("CARNET_DB_USER", "carnet"),
            password=os.environ["CARNET_DB_PASSWORD"],
            database=os.getenv("CARNET_DB_NAME", "carnet_projets"),
            connection_timeout=5,
            read_timeout=10,
            write_timeout=10,
            allow_local_infile=False,
            **({"ssl_ca": ca, "ssl_verify_cert": True, "ssl_verify_identity": True} if ca else {}),
        )
    return g.db


@app.teardown_appcontext
def close_db(_error):
    connection = g.pop("db", None)
    if connection:
        connection.close()


@app.after_request
def secure_headers(response):
    response.headers.update({
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'self'; font-src 'self' https://fonts.gstatic.com; style-src 'self' https://fonts.googleapis.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    })
    return response


def error(message, status):
    return jsonify(error=message), status


@app.errorhandler(mysql.connector.Error)
def storage_error(exc):
    app.logger.error("Erreur MySQL (%s)", exc.errno)
    return error("La base de données est momentanément indisponible.", 503)


def csrf_token():
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


def valid_csrf(token):
    return hmac.compare_digest(csrf_token().encode(), token.encode())


def token_hash(token):
    return hashlib.sha256(token.encode()).digest()


def owner_id():
    token = request.cookies.get(TOKEN_COOKIE, "")
    if not token:
        return None
    with db().cursor() as cursor:
        cursor.execute("SELECT owner FROM sessions WHERE token_hash=%s AND expires>UTC_TIMESTAMP()", (token_hash(token),))
        row = cursor.fetchone()
    db().commit()
    return row[0] if row else None


@app.get("/")
def index():
    if not owner_id():
        return redirect(url_for("login"))
    return send_from_directory(ROOT / "src", "index.html")


@app.get("/<any(app.js,style.css):asset>")
def assets(asset):
    return send_from_directory(ROOT / "src", asset)


@app.route("/connexion", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        if owner_id():
            return redirect(url_for("index"))
        return render_template("login.html", csrf=csrf_token(), email="")
    email = request.form.get("email", "").strip().lower()[:254]
    password = request.form.get("password", "")
    if not valid_csrf(request.form.get("csrf", "")):
        return render_template("login.html", csrf=csrf_token(), email=email, error="Session expirée. Réessayez."), 403
    with db().cursor(dictionary=True) as cursor:
        cursor.execute("SELECT id,password_hash,failures,retry_after FROM accounts WHERE email=%s FOR UPDATE", (email,))
        account = cursor.fetchone()
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        locked = account and account["retry_after"] and account["retry_after"] > now
        valid = not locked and len(password) <= 256 and check_password_hash(account["password_hash"] if account else DUMMY_HASH, password)
        if not account or not valid:
            if account and not locked:
                failures = account["failures"] + 1
                delay = min(300, 2 ** min(failures - 4, 9)) if failures >= 5 else 0
                cursor.execute("UPDATE accounts SET failures=%s,retry_after=%s WHERE id=%s", (failures, now + timedelta(seconds=delay), account["id"]))
            db().commit()
            return render_template("login.html", csrf=csrf_token(), email=email, error="Identifiants incorrects. Après plusieurs essais, patientez avant de réessayer."), 401

        token = secrets.token_urlsafe(32)
        cursor.execute("UPDATE accounts SET failures=0,retry_after=NULL WHERE id=%s", (account["id"],))
        cursor.execute("DELETE FROM sessions WHERE expires<=UTC_TIMESTAMP() OR token_hash=%s", (token_hash(request.cookies.get(TOKEN_COOKIE, "")),))
        cursor.execute("INSERT INTO sessions VALUES (%s,%s,UTC_TIMESTAMP()+INTERVAL 12 HOUR)", (token_hash(token), account["id"]))
    db().commit()
    session.clear()
    csrf_token()
    response = redirect(url_for("index"), code=303)
    response.set_cookie(TOKEN_COOKIE, token, max_age=43200, httponly=True,
                        secure=app.config["SESSION_COOKIE_SECURE"], samesite="Strict")
    return response


@app.get("/api/session")
def current_session():
    if not owner_id():
        return error("Connectez-vous pour accéder à votre carnet.", 401)
    return jsonify(csrf=csrf_token())


@app.post("/api/logout")
def logout():
    if not valid_csrf(request.headers.get("X-CSRF-Token", "")):
        return error("Session expirée. Rechargez la page.", 403)
    with db().cursor() as cursor:
        cursor.execute("DELETE FROM sessions WHERE token_hash=%s", (token_hash(request.cookies.get(TOKEN_COOKIE, "")),))
    db().commit()
    session.clear()
    response = jsonify(ok=True)
    response.delete_cookie(TOKEN_COOKIE, secure=app.config["SESSION_COOKIE_SECURE"], httponly=True, samesite="Strict")
    return response


@app.get("/api/records")
def records():
    owner = owner_id()
    if not owner:
        return error("Connectez-vous pour accéder à votre carnet.", 401)
    with db().cursor(dictionary=True) as cursor:
        cursor.execute("SELECT id,kind,COALESCE(parent,'') AS parent,data,updated FROM records WHERE owner=%s ORDER BY updated DESC", (owner,))
        return jsonify([{**json.loads(row.pop("data")), **row} for row in cursor.fetchall()])


@app.route("/api/records/<record_id>", methods=["PUT", "DELETE"])
def change_record(record_id):
    owner = owner_id()
    if not owner:
        return error("Connectez-vous pour accéder à votre carnet.", 401)
    if not valid_csrf(request.headers.get("X-CSRF-Token", "")):
        return error("Session expirée. Rechargez la page.", 403)
    if not RECORD_ID.fullmatch(record_id):
        return error("Adresse inconnue.", 404)
    with db().cursor(dictionary=True) as cursor:
        # Serialize writes in each account so moves cannot race with parent deletion.
        cursor.execute("SELECT id FROM accounts WHERE id=%s FOR UPDATE", (owner,))
        cursor.fetchone()
        cursor.execute("SELECT kind,updated FROM records WHERE owner=%s AND id=%s", (owner, record_id))
        existing = cursor.fetchone()
        if request.method == "DELETE":
            if not existing:
                return error("Fiche introuvable.", 404)
            cursor.execute("SELECT 1 FROM records WHERE owner=%s AND parent=%s LIMIT 1", (owner, record_id))
            if cursor.fetchone():
                return error("Retirez les éléments associés avant de supprimer cette fiche.", 409)
            cursor.execute("DELETE FROM records WHERE owner=%s AND id=%s", (owner, record_id))
            db().commit()
            return jsonify(ok=True)

        payload = request.get_json(silent=True)
        kind = payload.get("kind") if isinstance(payload, dict) else None
        if not isinstance(kind, str) or kind not in RESOURCES:
            return error("Catégorie invalide.", 400)
        if (existing and (existing["kind"] != kind or payload.get("updated") != existing["updated"])) or (not existing and payload.get("updated")):
            return error("La fiche a changé. Actualisez la page.", 409)
        parent_kind, fields = RESOURCES[kind]
        parent = payload.get("parent") if parent_kind else None
        if parent_kind:
            if not isinstance(parent, str) or not RECORD_ID.fullmatch(parent):
                return error("Dossier parent invalide.", 400)
            cursor.execute("SELECT 1 FROM records WHERE owner=%s AND id=%s AND kind=%s", (owner, parent, parent_kind))
            if not cursor.fetchone():
                return error("Dossier parent introuvable.", 409)
        data = {key: payload[key].strip() if isinstance(payload.get(key), str) else "" for key in fields.split()}
        if not 1 <= len(data["name"]) <= 160 or any(len(value) > ({"secret": 20000, "lines": 65000}.get(key, 8000)) for key, value in data.items()):
            return error("Vérifiez le nom et la longueur des champs.", 400)
        secret = data.get("secret")
        if secret and not re.fullmatch(r"v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+", secret):
            return error("Le mot de passe doit être chiffré.", 400)
        updated = datetime.now(timezone.utc).isoformat(timespec="microseconds")
        encoded = json.dumps(data, ensure_ascii=False)
        if existing:
            cursor.execute("UPDATE records SET parent=%s,data=%s,updated=%s WHERE owner=%s AND id=%s", (parent, encoded, updated, owner, record_id))
        else:
            cursor.execute("INSERT INTO records(owner,id,kind,parent,data,updated) VALUES (%s,%s,%s,%s,%s,%s)", (owner, record_id, kind, parent, encoded, updated))
    db().commit()
    return jsonify(id=record_id, kind=kind, parent=parent or "", updated=updated, **data)


@app.cli.command("init-db")
def init_db():
    with db().cursor() as cursor:
        cursor.execute((ROOT / "mysql.sql").read_text())
        while cursor.nextset():
            pass
    click.echo("Tables MySQL prêtes.")


@app.cli.command("create-user")
@click.argument("email")
@click.password_option()
def create_user(email, password):
    email = email.strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+", email):
        raise click.ClickException("Adresse courriel invalide.")
    if not 14 <= len(password) <= 256:
        raise click.ClickException("Choisissez un mot de passe de 14 à 256 caractères.")
    try:
        with db().cursor() as cursor:
            cursor.execute("INSERT INTO accounts(email,password_hash) VALUES (%s,%s)", (email, generate_password_hash(password)))
        db().commit()
    except IntegrityError as exc:
        if exc.errno == 1062:
            raise click.ClickException("Ce compte existe déjà.") from None
        raise
    click.echo("Compte créé.")

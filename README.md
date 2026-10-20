# animelist · Animes que quiero ver

Watchlist de anime con cuentas. Cada persona crea su usuario y guarda su propia lista en la nube.

**Página:** https://oscardevs10.github.io/animelist/

- Escribes el nombre de un anime y se cargan solos portada, episodios, géneros y sinopsis (AniList).
- Estados (Quiero ver / Viendo / Completado / Abandonado), prioridad, calificación y progreso por episodio.
- **Próximo episodio** de lo que estás viendo y **dónde verlo** (Crunchyroll, Netflix…), en vivo desde AniList.
- **Compartir tu lista** con un enlace (sin tus notas) y ver la de un amigo, con los animes en común.
- Registro con **código de invitación**.
- Filtros, búsqueda, estadísticas, sección "Descubrir", ruleta "¿Qué veo hoy?", modo oscuro.
- Se puede **instalar como app** en el celular.
- Respaldo: exportar / importar en JSON.

## Cómo está hecho

| Parte | Qué usa | Costo |
|---|---|---|
| Página | HTML + CSS + JavaScript, sin compilación | — |
| Hosting | GitHub Pages (se publica sola desde la rama `main`) | Gratis |
| Base de datos y login | [Supabase](https://supabase.com) (Postgres + Auth con correo y contraseña) | Gratis |
| Info de los animes | API pública de [AniList](https://anilist.co) | Gratis |
| Mantener Supabase activo | GitHub Actions (`.github/workflows/keepalive.yml`, lunes y jueves) | Gratis |

Archivos:

- `index.html`, `styles.css`, `app.js`: la página.
- `config.js`: URL y clave pública de Supabase.
- `manifest.webmanifest`, `sw.js`, `icons/`: lo necesario para instalarla como app.
- `supabase/schema.sql`: tabla `animes` y reglas de seguridad.
- `supabase/002_amigos_e_invitacion.sql`: perfiles, listas compartidas y código de invitación.

## Subir cambios

```bash
git add .
git commit -m "Describe tu cambio"
git push
```

GitHub Pages publica el cambio en 1–2 minutos. Puedes ver el avance en la pestaña **Actions** del repo.

Para probar en tu PC antes de subir, abre `index.html` con doble clic. Usa la misma base de datos que la página publicada.

## Código de invitación

Sin el código correcto, la base de datos rechaza el registro, aunque alguien intente registrarse llamando a la API directamente. El código no está en este repo: vive en la base de datos.

- **Ver el código:** en Supabase → SQL Editor, ejecuta `select value from private.settings where key = 'invite_code';`
- **Enlace para invitar:** `https://oscardevs10.github.io/animelist/?invitacion=TU-CODIGO`. Abre directo "Crear cuenta" con el código puesto.
- **Cambiarlo:** `update private.settings set value = 'nuevo-codigo' where key = 'invite_code';`
- **Quitar el requisito:** `update private.settings set value = '' where key = 'invite_code';`

## Configurar Supabase (solo una vez)

> El paso 2 con `schema.sql` ya está hecho en el proyecto `fxeaxhwhgmerdlwrthru`. Falta ejecutar `002_amigos_e_invitacion.sql` (ver paso 2).

1. Crea un proyecto gratis en https://supabase.com/dashboard.
2. Ve a **SQL Editor**, pega el contenido de `supabase/schema.sql` y pulsa **Run**. Después haz lo mismo con `supabase/002_amigos_e_invitacion.sql`; al final te muestra el código de invitación.
3. Ve a **Authentication → Sign In / Providers → Email** y desactiva **Confirm email**. Así tus amigos entran al crear su cuenta, sin esperar correo. El servicio de correo gratis de Supabase solo manda unos pocos correos por hora.
4. Ve a **Authentication → URL Configuration** y pon `https://oscardevs10.github.io/animelist/` en **Site URL** y en **Redirect URLs**. Lo usa el correo de "olvidé mi contraseña".
5. Ve a **Project Settings → API**, copia **Project URL** y la clave **anon / publishable** y pégalas en `config.js`.

### ¿Es seguro que la clave esté en el repo?

Sí. La clave `anon` / `publishable` está hecha para ir en el navegador. Lo que protege los datos son las políticas RLS de los archivos `.sql`:

- Cada usuario solo puede leer y modificar sus propias filas.
- Una lista compartida solo se puede ver con su enlace, que lleva un código aleatorio.
- Nadie puede listar todas las listas compartidas.

Nunca pongas aquí la clave `service_role` / `secret`.

## Usuarios

- Ver, borrar o resetear la contraseña de usuarios: [Supabase → Authentication → Users](https://supabase.com/dashboard/project/fxeaxhwhgmerdlwrthru/auth/users).
- Ver los datos guardados: [Supabase → Table Editor](https://supabase.com/dashboard/project/fxeaxhwhgmerdlwrthru/editor).

# animelist · Animes que quiero ver

Watchlist de anime y manga con cuentas. Cada persona crea su usuario con el enlace y guarda su propia lista en la nube.

**Página:** https://oscardevs10.github.io/animelist/

- Escribes el nombre de un anime **o manga / novela ligera** y se cargan solos portada, episodios o capítulos, géneros y sinopsis (AniList).
- **Directorio** (`#directorio`): todo el catálogo de AniList con búsqueda, filtros (género, formato, año, temporada, estado, orden) y scroll infinito; "+ Quiero ver" en cada título. Se puede explorar sin cuenta.
- **Ficha de cada título:** tráiler, personajes con su voz japonesa, estudio, temporadas y relacionados (cada uno con "+ Añadir").
- Estados, prioridad, calificación, progreso por episodio o capítulo, **listas propias** (#Favoritos, #Para ver con amigos…) y **reseña corta**.
- **Próximo episodio**, **dónde verlo** (Crunchyroll, Netflix…) y **aviso de nueva temporada** cuando terminaste algo que tiene continuación.
- **Historial:** se guarda cuántos episodios o capítulos marcas cada día. Con eso se calculan los **logros** y el **resumen anual** ("Tu año en anime"), que se puede compartir como imagen.
- **Compartir tu lista** con un enlace y ver la de un amigo con los títulos en común. Tus reseñas y listas se ven; tus notas privadas y tu historial, no.
- Filtros, búsqueda, estadísticas, "Descubrir", ruleta "¿Qué veo hoy?", modo oscuro, y se puede **instalar como app**.
- Respaldo: exportar / importar en JSON.

## Cómo está hecho

| Parte | Qué usa | Costo |
|---|---|---|
| Página | HTML + CSS + JavaScript, sin compilación | — |
| Hosting | GitHub Pages (se publica sola desde la rama `main`) | Gratis |
| Base de datos y login | [Supabase](https://supabase.com) (Postgres + Auth con correo y contraseña) | Gratis |
| Info de anime y manga | API pública de [AniList](https://anilist.co) | Gratis |
| Mantener Supabase activo | GitHub Actions (`.github/workflows/keepalive.yml`, lunes y jueves) | Gratis |

Archivos:

- `index.html`, `styles.css`, `app.js`: la página.
- `config.js`: URL y clave pública de Supabase.
- `manifest.webmanifest`, `sw.js`, `icons/`: lo necesario para instalarla como app.
- `supabase/schema.sql`: tabla `animes` y reglas de seguridad.
- `supabase/002_amigos_e_invitacion.sql`: perfiles y listas compartidas.
- `supabase/003_registro_libre.sql`: quita el código de invitación y oculta el historial en listas compartidas.

## Subir cambios

```bash
git add .
git commit -m "Describe tu cambio"
git push
```

GitHub Pages publica el cambio en 1–2 minutos. Puedes ver el avance en la pestaña **Actions** del repo.

Para probar en tu PC antes de subir, abre `index.html` con doble clic. Usa la misma base de datos que la página publicada.

## Invitar amigos

Pásales el enlace de la página. Pulsan **Crear cuenta** y listo; no hace falta código.

## Configurar Supabase (solo una vez)

> En el proyecto `fxeaxhwhgmerdlwrthru` ya se ejecutaron `schema.sql` y `002`. Falta ejecutar `003_registro_libre.sql` (paso 2).

1. Crea un proyecto gratis en https://supabase.com/dashboard.
2. Ve a **SQL Editor** y ejecuta, en orden, `supabase/schema.sql`, `supabase/002_amigos_e_invitacion.sql` y `supabase/003_registro_libre.sql`: pega cada uno y pulsa **Run**.
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

## Límites conocidos

- El historial guarda los últimos 365 días con actividad de cada título, para no pasar el límite de tamaño por fila de la base.
- Las fechas de término de lo que ya estaba completado antes del historial se toman de su última edición.
- El resumen anual empieza a llenarse desde que marcas episodios con **+**.
- Directorio de manga: al explorar sin buscar por nombre se muestran títulos con algo de popularidad (más de 1000 en AniList), porque AniList devuelve vacío con filtros muy amplios. Buscando por nombre aparecen todos.

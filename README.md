# animelist · Animes que quiero ver

Watchlist de anime con cuentas: cada persona crea su usuario y guarda su propia lista en la nube.

**Página:** https://oscardevs10.github.io/animelist/

- Escribes el nombre de un anime y se cargan solos portada, episodios, géneros y sinopsis (AniList).
- Estados (Quiero ver / Viendo / Completado / Abandonado), prioridad, calificación y progreso por episodio.
- Filtros, búsqueda, estadísticas, sección "Descubrir" y ruleta "¿Qué veo hoy?".
- Respaldo: exportar / importar en JSON.

## Cómo está hecho

| Parte | Qué usa | Costo |
|---|---|---|
| Página | HTML + CSS + JavaScript, sin compilación | — |
| Hosting | GitHub Pages (se publica sola desde la rama `main`) | Gratis |
| Base de datos y login | [Supabase](https://supabase.com) (Postgres + Auth con correo y contraseña) | Gratis |
| Info de los animes | API pública de [AniList](https://anilist.co) | Gratis |

Archivos:

- `index.html`, `styles.css`, `app.js`: la página.
- `config.js`: URL y clave pública de Supabase.
- `supabase/schema.sql`: tabla `animes` y reglas de seguridad.

## Subir cambios

```bash
git add .
git commit -m "Describe tu cambio"
git push
```

GitHub Pages publica el cambio en 1–2 minutos. Puedes ver el avance en la pestaña **Actions** del repo.

Para probar en tu PC antes de subir, abre `index.html` con doble clic. Usa la misma base de datos que la página publicada.

## Configurar Supabase (solo una vez)

> Ya está hecho para el proyecto `fxeaxhwhgmerdlwrthru`. Estos pasos sirven si algún día creas otro proyecto.

1. Crea un proyecto gratis en https://supabase.com/dashboard.
2. Ve a **SQL Editor**, pega el contenido de `supabase/schema.sql` y pulsa **Run**.
3. Ve a **Authentication → Sign In / Providers → Email** y desactiva **Confirm email**. Así tus amigos entran al crear su cuenta, sin esperar correo; el servicio de correo gratis de Supabase solo manda unos pocos correos por hora.
4. Ve a **Authentication → URL Configuration** y pon `https://oscardevs10.github.io/animelist/` en **Site URL** y en **Redirect URLs**. Lo usa el correo de "olvidé mi contraseña".
5. Ve a **Project Settings → API**, copia **Project URL** y la clave **anon / publishable** y pégalas en `config.js`.

### ¿Es seguro que la clave esté en el repo?

Sí. La clave `anon` / `publishable` está hecha para ir en el navegador. Lo que protege los datos son las políticas RLS de `schema.sql`: cada usuario solo puede leer y modificar sus propias filas.

Nunca pongas aquí la clave `service_role` / `secret`.

## Usuarios

Cualquier persona con el enlace puede crear una cuenta.

- Ver, borrar o resetear la contraseña de usuarios: [Supabase → Authentication → Users](https://supabase.com/dashboard/project/fxeaxhwhgmerdlwrthru/auth/users).
- Ver los datos guardados: [Supabase → Table Editor → animes](https://supabase.com/dashboard/project/fxeaxhwhgmerdlwrthru/editor).

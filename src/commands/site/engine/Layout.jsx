import navData from "./nav-data.js";

function NavItems({ items }) {
  return (
    <ul>
      {items.map((item, i) =>
        item.items ? (
          <li key={i} className="spool-nav-group">
            <span className="spool-nav-group-title">{item.text}</span>
            <NavItems items={item.items} />
          </li>
        ) : (
          <li key={i}>
            <a href={item.url}>{item.text}</a>
          </li>
        ),
      )}
    </ul>
  );
}

export function Layout({ meta, children }) {
  const pageTitle = meta?.title
    ? `${meta.title} | ${navData.title}`
    : navData.title;

  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{pageTitle}</title>
        {meta?.description && (
          <meta name="description" content={meta.description} />
        )}
        <link rel="stylesheet" href="/spool-site.css" />
      </head>
      <body>
        <div className="spool-layout">
          <aside className="spool-sidebar">
            <a href="/" className="spool-site-title">
              {navData.title}
            </a>
            <nav>
              <NavItems items={navData.sidebar} />
            </nav>
          </aside>
          <main className="spool-content">{children}</main>
        </div>
        <script src="/spool-highlight.js" />
      </body>
    </html>
  );
}

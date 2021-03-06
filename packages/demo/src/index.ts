import { CosmosClient, PartitionKeyDefinition } from '@cfworker/cosmos';
import { captureError } from '@cfworker/sentry';
import {
  Application,
  htmlEncode,
  HttpError,
  Middleware,
  Router,
  toObject,
  validate
} from '@cfworker/web';
import { getManagementToken, handleRegister } from './auth/management';
import {
  auth0Origin,
  authentication,
  getAuthorizeUrl,
  handleSignout,
  handleTokenCallback
} from './auth/oauth-flow';
import { html } from './html-stream';

const sentryLogging: Middleware = async (context, next) => {
  const { req, state } = context;
  try {
    await next();
  } catch (err) {
    if (!(err instanceof HttpError) || err.status === 500) {
      const { posted } = captureError(
        process.env.SENTRY_DSN,
        process.env.NODE_ENV,
        'demo',
        err,
        req.raw,
        state.user
      );
      context.waitUntil(posted);
    }
    throw err;
  }
};

const originAndRefererValidation: Middleware = async (context, next) => {
  const { url, method, headers } = context.req;

  const permitted = [url.origin, auth0Origin];

  const originHeader = headers.get('origin');
  if (originHeader && !permitted.includes(originHeader)) {
    throw new HttpError(400, `Invalid origin "${originHeader}"`);
  }

  const refererHeader = headers.get('referer');
  if (
    refererHeader &&
    method !== 'GET' &&
    !permitted.includes(new URL(refererHeader).origin)
  ) {
    throw new HttpError(400, `Invalid ${method} referer "${refererHeader}"`);
  }

  await next();
};

const notFoundPage: Middleware = async (
  { res, req: { url, accepts } },
  next
) => {
  await next();
  if (res.status === 404 && accepts.type('text/html')) {
    res.status = 404; // explicit status
    res.body = `<h1>Not Found</h1><p>Where in the world is ${htmlEncode(
      url.pathname
    )}?</p>`;
  }
};

const assertAuthenticated: Middleware = async (context, next) => {
  if (context.state.user) {
    await next();
    return;
  }
  if (context.req.accepts.type('text/html')) {
    context.res.redirect(getAuthorizeUrl(context.req.url));
    return;
  }
  throw new HttpError(
    401,
    `${context.req.url.pathname} requires authentication.`
  );
};

const router = new Router();

router
  .get('/', ({ res }) => {
    res.body = '<h1>This is it!</h1>';
  })
  .get('/echo-headers', ({ req, res }) => {
    res.status = 200;
    res.body = toObject(req.headers);
  })
  .get('/hello-world', ({ res }) => {
    res.body = 'hello world';
  })
  .get('/api/auth/callback', handleTokenCallback)
  .get('/sign-out', handleSignout)
  .get('/signed-out', ({ res }) => {
    res.body = 'signed out.';
    res.headers.set(
      'clear-site-data',
      '"cache", "cookies", "storage", "executionContexts"'
    );
  })
  .get('/error-test', errorTest)
  .get('/eject', context =>
    context.respondWith(new Response('ejected', { status: 200 }))
  )
  .post('/api/tenants', handleRegister)
  .get('/api/me', assertAuthenticated, ({ res, state }) => {
    res.body = state.user;
  })
  .get(
    '/api/greetings/:greeting',
    assertAuthenticated,
    validate({
      params: {
        required: ['greeting'],
        additionalProperties: false,
        properties: {
          greeting: {
            type: 'string',
            minLength: 5
          }
        }
      }
    }),
    ({ req, res }) => {
      res.body = req.params;
    }
  )
  .get('/stream', ({ res }) => {
    res.body = html` <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Demo</title>
        </head>

        <body>
          <h1>Demo</h1>
          <p>${getManagementToken().then(x => x.substr(0, 5))}</p>
          <p>
            ${fetch('https://example.com').then(response => response.body)}
          </p>
        </body>
      </html>`;
  })
  .get('/cosmos', async ctx => {
    const client = new CosmosClient({
      endpoint: process.env.COSMOS_DB_ORIGIN,
      masterKey: process.env.COSMOS_DB_MASTER_KEY,
      dbId: process.env.COSMOS_DB_DATABASE,
      collId: 'my-coll2'
    });
    const partitionKey: PartitionKeyDefinition = {
      paths: ['/_partitionKey'],
      kind: 'Hash'
    };
    const response = await client.getCollection();
    if (response.status === 404) {
      await client.createCollection({ partitionKey });
    }
    const document = { id: 'a', hello: 'world', _partitionKey: 'test' };
    await client.createDocument({
      document,
      partitionKey: 'test',
      isUpsert: true
    });
    document.id = 'b';
    await client.createDocument({
      document,
      partitionKey: 'test',
      isUpsert: true
    });
    document.id = 'c';
    await client.createDocument({
      document,
      partitionKey: 'test',
      isUpsert: true
    });
    document.id = 'd';
    await client.createDocument({
      document,
      partitionKey: 'test',
      isUpsert: true
    });
    document.id = 'e';
    await client.createDocument({
      document,
      partitionKey: 'test',
      isUpsert: true
    });
    document.id = 'f';
    await client.createDocument({
      document,
      partitionKey: 'test',
      isUpsert: true
    });
    const res = await client.queryDocuments({
      query: 'select x.id from ROOT x',
      partitionKey: 'test',
      parameters: [{ name: '@a', value: 'f' }]
    });
    ctx.res.body = await res.json();
  })
  .get('/cosmos2', async ctx => {
    const client = new CosmosClient({
      endpoint: process.env.COSMOS_DB_ORIGIN,
      masterKey: process.env.COSMOS_DB_MASTER_KEY,
      dbId: process.env.COSMOS_DB_DATABASE,
      collId: 'my-coll2'
    });
    const res = await client.queryDocuments({
      query: 'select x.id from ROOT x',
      partitionKey: 'test',
      parameters: [{ name: '@a', value: 'f' }]
    });
    ctx.res.body = await res.json();
  })
  .get('/favicon.ico', ({ res }) => {
    res.type = 'image/svg+xml';
    res.body = `
        <svg xmlns="http://www.w3.org/2000/svg" baseProfile="full" width="200" height="200">
          <rect width="100%" height="100%" fill="#F38020"/>
          <text font-size="120" font-family="Arial, Helvetica, sans-serif" text-anchor="end" fill="#FFF" x="185" y="185">W</text>
        </svg>`;
  });

new Application()
  .use(sentryLogging)
  .use(originAndRefererValidation)
  .use(authentication)
  .use(notFoundPage)
  .use(router.middleware)
  .listen();

function errorTest() {
  function bar() {
    // @ts-ignore
    if (a.b.c.d) {
      return;
    }
  }

  function foo() {
    return bar();
  }

  return foo();
}

/*
    let message: string;
    if (String(process.env.NODE_ENV) === 'development') {
      message = err.stack;
    } else {
      message = `Event ID: ${event_id}`;
    }
    res.status = 500;
    if (req.accepts.type('text/html')) {
      res.body = `<h1>Internal Server Error</h1><p><pre><code>${htmlEncode(
        message
      )}</code></pre></p>`;
      res.headers.set('content-type', 'text/html');
    } else {
      res.body = message;
      res.headers.set('content-type', 'text/plain');
    }
*/

# deluge-rpc-socket

Node.js client for Deluge's binary RPC socket API. Works against Deluge 1.x
(protocol v0) and 2.x (protocol v1), auto-detects which one the daemon
speaks.

[![CI](https://github.com/cinderblock/node-deluge-rpc/actions/workflows/ci.yml/badge.svg)](https://github.com/cinderblock/node-deluge-rpc/actions/workflows/ci.yml)

## Install

```bash
bun add deluge-rpc-socket
# or
npm install deluge-rpc-socket
```

ESM-only. Requires Bun ≥ 1.3 or Node ≥ 22.

## Usage

```ts
import DelugeRPC, { isRPCError } from 'deluge-rpc-socket';
import { connect } from 'tls';

const socket = connect(58846, {
  // Deluge daemons usually use a self-signed certificate
  rejectUnauthorized: false,
});

const rpc = DelugeRPC(socket);

// Asynchronous events from the daemon (torrent state changes, etc.)
rpc.events.on('delugeEvent', console.log);

// Non-fatal decoding errors — something's wrong with the wire format
rpc.events.on('decodingError', console.log);

// Wait for socket.on('secureConnect', ...) before issuing RPC calls

async function login(username: string, password: string): Promise<boolean> {
  const { result, sent } = rpc.daemon.login(username, password);

  try {
    await sent;
  } catch {
    console.log('Login message not sent');
    return false;
  }

  const res = await result;
  if (isRPCError(res)) {
    console.log('Login error:', res.error);
    return false;
  }

  return true;
}

async function addTorrent(url: string): Promise<boolean> {
  const { result, sent } = rpc.core.addTorrentUrl(url);
  await sent;
  const res = await result;
  return !isRPCError(res);
}
```

### Deluge 2.x and `client_version`

Deluge 2.x's `daemon.login` raises `IncompatibleClient` if the request
doesn't include a `client_version` kwarg. This library always sends one;
the default is its own package version. Override it if you need to
impersonate a specific Deluge client:

```ts
const rpc = DelugeRPC(socket, { clientVersion: '2.1.1' });
```

### Arguments

All arguments to API functions at any depth can be promises — they are
awaited before being sent.

### camelCase vs snake_case

API method names are camelCase (`rpc.core.addTorrentUrl`). Data is passed
through unchanged in both directions: option keys must use Deluge's own
snake_case names (`{ download_location: '/data' }`), and responses keep the
keys Deluge sent (`status.total_wanted`).

This fork dropped the automatic camelCase/snake_case key conversion that the
upstream library does. It cost performance and only made the code more
complicated:

- **Performance:** every response, error and event was walked recursively
  and copied into a new object just to rename keys. Large responses such as
  `get_torrents_status` for many torrents paid for this on every call.
- **Complexity:** two extra dependencies (one untyped, called through
  `as any`), a `try/catch` that silently swallowed conversion errors, and a
  table of about 90 duplicated snake_case/camelCase method aliases.
- **Correctness:** the conversion also renamed keys that are data, not field
  names, such as tracker names and labels from `get_filter_tree` or plugin
  keys in `get_config`.

## Change Log

### Unreleased (breaking)

- **Removed:** automatic key conversion. Responses and events are no longer
  converted to camelCase, and option objects are no longer converted to
  snake_case. Deep conversion also rewrote keys that are data, such as tracker
  names and labels from `get_filter_tree` or plugin keys in `get_config`.
  The `camelCaseResponses` option is gone.
- **Removed:** snake_case method aliases (`rpc.core.add_torrent_url` etc.).
  Use the camelCase names (`rpc.core.addTorrentUrl`).
- **Removed:** dependencies `camelcase-keys-deep` and `snakecase-keys`.

### v1.0.1

- **Fixed:** Deluge 2.x (protocol v1) responses were decoded five bytes short.
  The receive path ended the payload slice at `payloadLength` rather than at
  `packetLength`, and `Buffer.slice` takes an end offset rather than a count.
  The lost bytes are the Adler-32 trailer plus the final deflate byte, which
  usually holds only the end-of-block code and padding — so most responses
  still decoded and the bug stayed hidden. When that byte carried real symbol
  bits the inflated output came up short and rencode threw
  `Tried to access data[N] but data len is: N`. Reported and fixed by
  [@dkacperski97](https://github.com/dkacperski97) in
  [#16](https://github.com/cinderblock/node-deluge-rpc/pull/16).
- **Fixed:** A packet that fails to decode is now reported via the
  `decodingError` event and skipped, instead of throwing out of the socket
  `data` handler as an uncaught exception that took the process down. Packets
  behind the bad one still parse.
- **Tests:** First coverage of the protocol v1 receive path, replaying a real
  frame captured off a Deluge 2.2 daemon.

### v1.0.0

Promoted from `1.0.0-alpha` after consumer validation against a real
Deluge 2.x daemon. No functional changes from the alpha.

- **Toolchain:** Bun-first; ESM; TypeScript 6; dropped yarn/ts-jest/ts-node/coveralls/cspell.
- **Deps:** Bumped `python-rencode` to `^2.0.0` and `smallest-power-of-two` to `^2.0.0`.
- **Tests:** Ported from jest to `bun:test`. Integration tests against a real
  daemon now gate on `DELUGE1_PORT` (or `DELUGE_PORT`) and are skipped in CI.
- **CI:** New bun-based `ci.yml` and `publish.yml`; publishing uses npm
  Trusted Publishing (OIDC, with provenance). Pre-release versions go to
  the `next` dist-tag.
- **Breaking:** ESM-only, no CommonJS `require`. The runtime API is unchanged
  from `v0.5.0`; migration is just the import switch.

### v0.5.0

- Fixed `IncompatibleClient` when logging in to Deluge 2.x daemons by
  sending the required `client_version` kwarg (it was never sent in
  v0.4.0). Added a `clientVersion` factory option.
- Replaced the broken legacy publish job with a tag-triggered Trusted
  Publishing workflow.

### v0.4.0 and earlier

See [git tags](https://github.com/cinderblock/node-deluge-rpc/tags).

## Development

```bash
bun install
bun run lint     # type-check
bun test src     # unit tests
bun run build    # tsc → dist/
```

Integration tests against a real Deluge daemon:

```bash
DELUGE1_PORT=58846 DELUGE1_HOST=localhost bun test src
```

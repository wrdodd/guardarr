const test = require("node:test");
const assert = require("node:assert/strict");
const { parseUsers, parseSharedServers, decodeFilter, putSharedLibraries, putUserFilters } = require("../lib/plex-api.js");

// These XML shapes are what plex.tv actually returns; parsing them with a real
// parser (rather than regex) is what keeps the reconcile loop from seeing phantom
// drift when attribute order or escaping changes.

test("parseUsers extracts ids and filters", () => {
  const xml = `<?xml version="1.0"?>
    <MediaContainer size="2">
      <User id="680110216" username="karyli5" filterMovies="contentRating=G,PG" filterTelevision="contentRating=TV-Y"/>
      <User id="462126" username="smunoz" filterMovies="" filterTelevision=""/>
    </MediaContainer>`;
  const map = parseUsers(xml);
  assert.equal(map.size, 2);
  assert.equal(map.get("680110216").movies, "contentRating=G,PG");
  assert.equal(map.get("680110216").username, "karyli5");
  assert.equal(map.get("462126").movies, "");
});

test("parseUsers percent-decodes filter values", () => {
  // Plex echoes back "label!=Unrated%2CAdult"; comparison against a generated
  // filter only works once decoded.
  const xml = `<MediaContainer><User id="1" username="a" filterMovies="label!=Unrated%2CAdult"/></MediaContainer>`;
  assert.equal(parseUsers(xml).get("1").movies, "label!=Unrated,Adult");
});

test("parseUsers is not order-dependent (the regex weakness)", () => {
  const xml = `<MediaContainer><User filterTelevision="contentRating=TV-G" username="z" filterMovies="contentRating=G" id="7"/></MediaContainer>`;
  const u = parseUsers(xml).get("7");
  assert.equal(u.movies, "contentRating=G");
  assert.equal(u.tv, "contentRating=TV-G");
});

test("parseUsers handles a single user and an empty container", () => {
  // fast-xml-parser collapses a lone child to an object rather than an array.
  assert.equal(parseUsers(`<MediaContainer><User id="1" username="solo"/></MediaContainer>`).size, 1);
  assert.equal(parseUsers(`<MediaContainer/>`).size, 0);
});

test("parseUsers decodes XML entities in values", () => {
  const xml = `<MediaContainer><User id="1" username="a&amp;b" filterMovies=""/></MediaContainer>`;
  assert.equal(parseUsers(xml).get("1").username, "a&b");
});

test("decodeFilter tolerates a stray percent sign", () => {
  assert.equal(decodeFilter("100%"), "100%");
  assert.equal(decodeFilter(""), "");
});

test("parseSharedServers returns per-user library access", () => {
  const xml = `<MediaContainer>
      <SharedServer id="55" username="kid" userID="900" email="k@x.com">
        <Section id="1" key="1" title="Movies" type="movie" shared="1"/>
        <Section id="2" key="2" title="TV Shows" type="show" shared="0"/>
      </SharedServer>
    </MediaContainer>`;
  const [u] = parseSharedServers(xml);
  assert.equal(u.id, "55");
  assert.equal(u.username, "kid");
  assert.equal(u.totalLibraries, 2);
  assert.equal(u.sharedCount, 1);
  assert.equal(u.libraries[0].shared, true);
  assert.equal(u.libraries[1].shared, false);
  assert.equal(u.libraries[0].title, "Movies");
});

test("parseSharedServers handles a server with one section", () => {
  const xml = `<MediaContainer><SharedServer id="1" username="a"><Section id="4" key="4" title="Kids" type="movie" shared="1"/></SharedServer></MediaContainer>`;
  assert.equal(parseSharedServers(xml)[0].libraries.length, 1);
});

test("putUserFilters always sends both filter params so they can be cleared", () => {
  let captured;
  const fakeFetch = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 200 }; };
  return putUserFilters("123", "tok", "", "", fakeFetch).then(() => {
    const q = new URL(captured.url).searchParams;
    assert.equal(captured.opts.method, "PUT");
    assert.equal(q.get("filterMovies"), "");
    assert.equal(q.get("filterTelevision"), "");
  });
});

test("putSharedLibraries sends one repeated field per section id", () => {
  let captured;
  const fakeFetch = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 200 }; };
  return putSharedLibraries("machine", "55", ["1", "3"], "tok", fakeFetch).then(() => {
    assert.match(captured.url, /shared_servers\/55$/);
    assert.equal(captured.opts.method, "PUT");
    const body = new URLSearchParams(captured.opts.body);
    assert.deepEqual(body.getAll("sharedServer[librarySectionIds][]"), ["1", "3"]);
  });
});

test("a failed write rejects rather than reporting success", async () => {
  const fakeFetch = async () => ({ ok: false, status: 401 });
  await assert.rejects(() => putUserFilters("1", "t", "a", "b", fakeFetch), /401/);
});

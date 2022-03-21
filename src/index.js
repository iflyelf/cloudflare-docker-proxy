addEventListener("fetch", (event) => {
  event.passThroughOnException();
  event.respondWith(handleRequest(event.request));
});

const routes = {
  "docker.libcuda.so": "https://registry-1.docker.io",
  "quay.libcuda.so": "https://quay.io",
  "gcr.libcuda.so": "https://k8s.gcr.io",
  "ghcr.libcuda.so": "https://ghcr.io",
};

function routeByHosts(host) {
  if (host in routes) {
    return routes[host];
  }
  return TARGET_UPSTREAM ? TARGET_UPSTREAM : "";
}

async function handleRequest(request) {
  const url = new URL(request.url);
  if (url.pathname == "/v2/") {
    const resp = new Response({}, { status: 401 });
    resp.headers = new Headers();
    if (DEBUG) {
      resp.headers.set(
        "Www-Authenticate",
        `Bearer realm="${LOCAL_ADDRESS}/v2/auth",service="cloudflare-docker-proxy"`
      );
    } else {
      resp.headers.set(
        "Www-Authenticate",
        `Bearer realm="https://${url.hostname}/v2/auth",service="cloudflare-docker-proxy"`
      );
    }
    return resp;
  }
  const upstream = routeByHosts(url.hostname);
  if (upstream === "") {
    return new Response(
      JSON.stringify({
        routes: routes,
      })
    );
  }
  if (url.pathname == "/v2/auth") {
    const newUrl = new URL(upstream + "/v2/");
    const resp = await fetch(newUrl.toString(), {
      method: "GET",
      redirect: "follow",
    });
    if (resp.status !== 401) {
      return resp;
    }
    const authenticateStr = resp.headers.get("WWW-Authenticate");
    if (authenticateStr === null) {
      return resp;
    }
    const wwwAuthenticate = parseAuthenticate(authenticateStr);
    return await fetchToken(wwwAuthenticate, url.searchParams);
  }
  const newUrl = new URL(upstream + url.pathname);
  const newReq = new Request(newUrl, {
    method: request.method,
    headers: request.headers,
    redirect: "follow",
  });
  return await fetch(newReq);
}

function parseAuthenticate(authenticateStr) {
  // sample: Bearer realm="https://auth.ipv6.docker.com/token",service="registry.docker.io"
  // match strings after =" and before "
  const re = /(?<=\=")(?:\\.|[^"\\])*(?=")/g;
  const matches = authenticateStr.match(re);
  if (matches === null || matches.length < 2) {
    throw new Error(`invalid Www-Authenticate Header: ${authenticateStr}`);
  }
  return {
    realm: matches[0],
    service: matches[1],
  };
}

async function fetchToken(wwwAuthenticate, searchParams) {
  const url = new URL(wwwAuthenticate.realm);
  if (wwwAuthenticate.service.length) {
    url.searchParams.set("service", wwwAuthenticate.service);
  }
  if (searchParams.get("scope")) {
    url.searchParams.set("scope", searchParams.get("scope"));
  }
  return await fetch(url, { method: "GET", headers: {} });
}
export type SellerRepairBrief = Readonly<{
  id: string;
  seller: string;
  origin: string;
  route: string;
  method: "GET" | "POST";
  routeClass: "paid_get" | "paid_post";
  observedAt: string;
  livePrice: string;
  summary: string;
  observedContract: readonly string[];
  requiredContract: readonly string[];
  scope: readonly string[];
  boundaries: readonly string[];
  evidence: readonly Readonly<{ label: string; href: string }>[];
}>;

export const sellerRepairBriefs = Object.freeze([
  {
    id: "hypernatt-liq-radar-20260830",
    seller: "HyperNatt Terminal",
    origin: "https://hypernatt.com",
    route: "/api/m2m/liq-radar",
    method: "GET",
    routeClass: "paid_get",
    observedAt: "2026-08-30",
    livePrice: "0.001 USDC",
    summary:
      "The live Base and Solana offer describes a detailed liquidation-radar payload, but the formal success contracts do not guarantee those fields before payment.",
    observedContract: [
      "OpenAPI describes HTTP 200 only as OK, without a media type or schema.",
      "The live Bazaar schema requires output.type but leaves output.example unconstrained.",
      "The example advertises product, payload_schema, symbol, and liq_radar without requiring any of them.",
    ],
    requiredContract: [
      "Declare the successful application/json response schema for the exact route.",
      "Require a stable handler-owned core and recursively require every buyer-critical path.",
      "Keep variable arrays and optional market observations optional unless runtime behavior guarantees them.",
    ],
    scope: [
      "One truthful OpenAPI 200 schema and matching Bazaar projection.",
      "Credential-free contract, parity, and live unpaid-402 tests.",
      "No handler, price, rail, wallet, recipient, or payment-middleware change.",
    ],
    boundaries: [
      "No credential, signature, target request, wallet action, or target payment was used to reproduce this finding.",
      "The seller confirms the real runtime types and semantics before any schema repair is merged.",
    ],
    evidence: [
      { label: "Live unpaid 402 route", href: "https://hypernatt.com/api/m2m/liq-radar" },
      { label: "Public OpenAPI", href: "https://hypernatt.com/openapi.json" },
    ],
  },
  {
    id: "onesource-erc20-balance-20260830",
    seller: "OneSource",
    origin: "https://api.onesource.io",
    route: "/api/chain/erc20-balance",
    method: "GET",
    routeClass: "paid_get",
    observedAt: "2026-08-30",
    livePrice: "0.003 USDC",
    summary:
      "OpenAPI, the live Bazaar contract, the advertised example, and the live payment amount disagree on the exact request and result a buyer should authorize.",
    observedContract: [
      "OpenAPI requires address and contract; the live Bazaar input requires account and token.",
      "The success schema requires data and meta but does not require a handler-owned field inside data, including balance.",
      "The live payment schemes require 3,000 atomic USDC while the Bazaar output example says cost_usdc 0.001.",
    ],
    requiredContract: [
      "Choose one authoritative request vocabulary and project it identically through OpenAPI and Bazaar.",
      "Require the stable handler-owned balance result and any buyer-critical metadata.",
      "Reconcile the advertised example price with the live offer amount.",
    ],
    scope: [
      "One-route OpenAPI and Bazaar coherence repair with focused regression tests.",
      "A buyer-constructibility and success-contract replay against the credential-free live 402.",
      "No handler, price, rail, wallet, recipient, or payment-middleware change unless the seller identifies a different authority.",
    ],
    boundaries: [
      "No credential, signature, target application request, wallet action, or target payment was used to reproduce this finding.",
      "The seller confirms which parameter names, result fields, and price are authoritative before a repair is merged.",
    ],
    evidence: [
      { label: "Live unpaid 402 route", href: "https://api.onesource.io/api/chain/erc20-balance" },
      { label: "Public OpenAPI", href: "https://api.onesource.io/openapi.json" },
    ],
  },
  {
    id: "402-com-tr-morpho-health-20260830",
    seller: "x402 Bazaar",
    origin: "https://402.com.tr",
    route: "/api/x402/morpho-health",
    method: "GET",
    routeClass: "paid_get",
    observedAt: "2026-08-30",
    livePrice: "0.04 USDC on Base or Polygon",
    summary:
      "The live offer describes decision-grade Morpho liquidation health, but neither OpenAPI nor Bazaar formally guarantees a single returned field before payment.",
    observedContract: [
      "OpenAPI declares the HTTP 200 body only as an object, without properties or required fields.",
      "The live Bazaar schema requires output.type but leaves output.example as an unconstrained object.",
      "The example advertises checkedAt, wallet, market, pair, verdict, collateral, collateralToken, and borrowed without requiring any of them.",
    ],
    requiredContract: [
      "Require the stable handler-owned fields shared by every successful result, including checkedAt, wallet, market, pair, and verdict.",
      "Model active-position and no_borrow outcomes separately so health, LTV, and liquidation fields are required only when the handler guarantees them.",
      "Project the same schema through OpenAPI and Bazaar and keep the public example schema-valid.",
    ],
    scope: [
      "One truthful OpenAPI 200 schema and matching Bazaar projection for every existing success branch.",
      "Credential-free request, success-branch, parity, recursive-required-path, and unchanged live-402 tests.",
      "No handler, price, rail, recipient, prepaid-credit, middleware, or settlement change.",
    ],
    boundaries: [
      "No credential, signature, target paid request, wallet action, or target payment was used to reproduce this finding.",
      "The seller confirms the real branch shapes and field semantics before any schema repair is merged.",
    ],
    evidence: [
      {
        label: "Live unpaid 402 route",
        href: "https://402.com.tr/api/x402/morpho-health?wallet=0x973a31858f4d2125f48c880542da11a2796f12d6",
      },
      { label: "Public OpenAPI", href: "https://402.com.tr/openapi.json" },
      {
        label: "Public operator repository",
        href: "https://github.com/sukrutkrdg/x402-bazaar-mcp",
      },
    ],
  },
  {
    id: "scrape402-crypto-20260830",
    seller: "scrape402",
    origin: "https://x402.shizu.me",
    route: "/crypto",
    method: "GET",
    routeClass: "paid_get",
    observedAt: "2026-08-30",
    livePrice: "0.007 USDC on Base",
    summary:
      "The live route advertises current crypto prices for one or up to ten pairs, but OpenAPI and Bazaar do not formally guarantee the single-pair fields or the batch envelope before payment.",
    observedContract: [
      "OpenAPI provides a 200 example with pair, amount, and currency but no response schema.",
      "The live Bazaar declaration publishes an output example but no formal output schema.",
      "OpenAPI makes pair optional while the live Bazaar input contract requires it.",
      "The advertised multi-pair mode has no buyer-visible envelope or per-item guarantee.",
    ],
    requiredContract: [
      "Choose one authoritative pair-input rule and declare the successful JSON shape for both single-pair and multi-pair requests.",
      "Require pair, amount, and currency on every returned price item and define the batch envelope exactly.",
      "Project the same success contract through OpenAPI and Bazaar and keep both examples schema-valid.",
    ],
    scope: [
      "One truthful OpenAPI 200 schema and matching Bazaar projection for the existing route modes.",
      "Credential-free single-pair, multi-pair, parity, recursive-required-path, and unchanged live-402 tests.",
      "No handler, price, rail, recipient, payment middleware, or production-source assumption.",
    ],
    boundaries: [
      "No credential, signature, target paid request, wallet action, or target payment was used to reproduce this finding.",
      "The public repository contains calling examples, not the production server source; the operator confirms the real branch shapes before any repair.",
    ],
    evidence: [
      { label: "Live unpaid 402 route", href: "https://x402.shizu.me/crypto" },
      { label: "Public OpenAPI", href: "https://x402.shizu.me/openapi.json" },
      {
        label: "Public examples repository",
        href: "https://github.com/scrape402/x402-examples",
      },
    ],
  },
  {
    id: "vibe-springs-btc-usd-20260830",
    seller: "Vibe Springs",
    origin: "https://vibesprings.net",
    route: "/api/price/btc-usd",
    method: "GET",
    routeClass: "paid_get",
    observedAt: "2026-08-30",
    livePrice: "0.002 USDC on Base",
    summary:
      "The live offer advertises a Coinbase-sourced BTC/USD oracle with price and 24-hour market data, but neither OpenAPI nor Bazaar formally guarantees a returned application field before payment.",
    observedContract: [
      "OpenAPI declares the HTTP 200 body only as an object, without properties or required fields.",
      "The live Bazaar schema requires output.type but leaves output.example as an unconstrained object.",
      "The example advertises symbol, price, currency, exchange, 24-hour change, high, low, volume, and processing time without requiring any of them.",
    ],
    requiredContract: [
      "Require the stable handler-owned identity and quote fields shared by every successful result, including symbol, price, currency, and exchange.",
      "Require the advertised 24-hour market fields only where the live handler guarantees them; keep processingTime optional unless it is a stable contract.",
      "Project the same success schema through OpenAPI and Bazaar and keep the public example schema-valid.",
    ],
    scope: [
      "One truthful OpenAPI 200 schema and matching Bazaar projection for the existing success path.",
      "Credential-free contract, parity, recursive-required-path, and unchanged live-402 tests.",
      "No handler, price, rail, recipient, middleware, upstream-data-source, or settlement change.",
    ],
    boundaries: [
      "No credential, signature, target paid request, wallet action, or target payment was used to reproduce this finding.",
      "The seller confirms the real runtime types and guarantees before any schema repair is merged.",
    ],
    evidence: [
      { label: "Live unpaid 402 route", href: "https://vibesprings.net/api/price/btc-usd" },
      { label: "Public OpenAPI", href: "https://vibesprings.net/openapi.json" },
      {
        label: "Public MCP repository",
        href: "https://github.com/chrispy90/vibesprings-mcp",
      },
    ],
  },
  {
    id: "blockrun-exa-search-20260830",
    seller: "BlockRun",
    origin: "https://blockrun.ai",
    route: "/api/v1/exa/search",
    method: "POST",
    routeClass: "paid_post",
    observedAt: "2026-08-30",
    livePrice: "0.011 USDC on Base",
    summary:
      "The live Exa route has a well-defined request and active catalog record, but neither OpenAPI nor Bazaar formally guarantees a returned application field before payment.",
    observedContract: [
      "OpenAPI requires a JSON body with query, but describes HTTP 200 only as Exa search results without a media type or response schema.",
      "The live Bazaar record sets output to null and its schema leaves the example results array and every result field optional.",
      "BlockRun's seller-owned public Exa skill consumes results with title and url; this is intended-use evidence, not independent buyer demand or a formal response guarantee.",
    ],
    requiredContract: [
      "Declare the successful application/json envelope and require results when every successful search returns it.",
      "Require only result fields the live handler guarantees on every item; the seller-owned skill suggests title and url as the first contract candidates to verify.",
      "Project the same success contract through OpenAPI and Bazaar and keep the public example schema-valid.",
    ],
    scope: [
      "One truthful OpenAPI 200 schema and matching Bazaar projection for the existing Exa search route.",
      "Credential-free request, fixture, recursive-required-path, OpenAPI/Bazaar parity, and unchanged live-offer tests.",
      "No handler, request, price, rail, recipient, wallet, payment middleware, or other-route change.",
    ],
    boundaries: [
      "No credential, signature, target paid request, wallet action, or target payment was used to reproduce this finding.",
      "The seller confirms the real success envelope, item branches, runtime types, and guarantees before any schema repair is merged.",
    ],
    evidence: [
      { label: "Public OpenAPI", href: "https://blockrun.ai/openapi.json" },
      {
        label: "Live Coinbase Bazaar record",
        href: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=blockrun%20exa%20search&limit=10",
      },
      {
        label: "Public Exa client and skill",
        href: "https://github.com/BlockRunAI/blockrun-mcp/tree/main/skills/exa-research",
      },
    ],
  },
  {
    id: "exa-direct-search-20260830",
    seller: "Exa",
    origin: "https://api.exa.ai",
    route: "/search",
    method: "POST",
    routeClass: "paid_post",
    observedAt: "2026-08-30",
    livePrice: "0.007 USDC on Base or Solana",
    summary:
      "Exa's seller-owned OpenAPI already guarantees the default JSON search result, but the live Coinbase Bazaar projection drops that contract before payment.",
    observedContract: [
      "OpenAPI requires results on every SearchResponse branch and requires title and url on every SearchResultOutput item.",
      "The live Bazaar schema requires only output.type; output.example is unconstrained, so results and every item field become optional on the discovery surface.",
      "The live exact offer is 0.007 USDC on Base or Solana, while OpenAPI separately declares dynamic search pricing and an MPP method; this brief changes neither.",
    ],
    requiredContract: [
      "Project the existing OpenAPI SearchResponse authority into Bazaar for the default application/json purchase path.",
      "Require results and preserve the seller-owned per-item title and url requirements without strengthening optional result metadata.",
      "Keep the published example schema-valid and add OpenAPI-to-Bazaar recursive-required-path parity tests.",
    ],
    scope: [
      "One Bazaar success-contract projection for the existing direct Exa search offer.",
      "Credential-free catalog readback, example validation, recursive-required-path, and OpenAPI/Bazaar parity tests.",
      "No handler, OpenAPI source, request, price, rail, recipient, wallet, payment middleware, streaming branch, or other-route change.",
    ],
    boundaries: [
      "No credential, signature, target application request, wallet action, or target payment was used to reproduce this finding.",
      "The repair reuses Exa's published OpenAPI authority and does not infer guarantees from examples, counters, or client behavior.",
    ],
    evidence: [
      { label: "Authoritative Exa OpenAPI", href: "https://api.exa.ai/openapi.json" },
      {
        label: "Live Coinbase Bazaar record",
        href: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=exa%20search&limit=20",
      },
      { label: "Official Exa x402 guide", href: "https://exa.ai/docs/reference/x402-guide" },
      { label: "Official Exa JavaScript SDK", href: "https://github.com/exa-labs/exa-js" },
    ],
  },
  {
    id: "driftflight-image-generation-20260830",
    seller: "Driftflight via ZeroClick",
    origin: "https://agents.driftflight.com",
    route: "/v1/images/generate",
    method: "POST",
    routeClass: "paid_post",
    observedAt: "2026-08-30",
    livePrice: "0.06 USDC for the default studio tier",
    summary:
      "The agent-facing storefront publishes a typed image-generation request and live x402/MPP price, but its HTTP 200 response declares no media type, schema, or guaranteed application field before payment.",
    observedContract: [
      "OpenAPI requires prompt and declares the allowed model and preset inputs, while HTTP 200 has only the text Successful response.",
      "The route's payment metadata prices the default studio image at 0.06 USDC and names Base x402 and Tempo MPP rails.",
      "ZeroClick's live storefront exposes three image tiers but contactEmail is null; Driftflight's published email domain currently cannot accept the repair message.",
    ],
    requiredContract: [
      "Declare the successful application/json response envelope for every existing image-generation success branch.",
      "Require only stable handler-owned result fields that the seller guarantees for sketch, studio, and gallery outputs.",
      "Project the same success contract through the storefront and any downstream capability record without inferring fields from examples or counters.",
    ],
    scope: [
      "One truthful OpenAPI 200 schema and matching agent-storefront projection for the existing route.",
      "Credential-free request, success-branch, recursive-required-path, and unchanged live-offer tests.",
      "No handler, prompt contract, model tiers, price, rail, recipient, wallet, proxy, payment middleware, or settlement change.",
    ],
    boundaries: [
      "No credential, signature, target application request, wallet action, or target payment was used to reproduce this finding.",
      "Driftflight and ZeroClick confirm the real success branches, runtime types, and ownership boundary before any schema repair is merged.",
    ],
    evidence: [
      { label: "Agent-facing OpenAPI", href: "https://agents.driftflight.com/openapi.json" },
      { label: "Live agent storefront", href: "https://agents.driftflight.com/" },
      { label: "ZeroClick operating model", href: "https://docs.zeroclick.ai/" },
    ],
  },
  {
    id: "agenttoll-market-radar-20260901",
    seller: "AgentToll",
    origin: "https://agenttoll.dev",
    route: "/paid/x402/market-radar",
    method: "POST",
    routeClass: "paid_post",
    observedAt: "2026-09-01 PDT",
    livePrice: "0.05 USDC",
    summary:
      "The live market-radar route returns a handler-owned report envelope, but OpenAPI declares only a bare object and Bazaar guarantees only its wrapper type while the example advertises application fields.",
    observedContract: [
      "The current live OpenAPI HTTP 200 schema is only the bare object type and requires no application field.",
      "The current Bazaar output guarantees only the wrapper type while its example advertises application fields.",
      "The public MIT handler always owns product, service, generated_at, catalog, and agenttoll on HTTP 200.",
    ],
    requiredContract: [
      "Require only product, service, generated_at, catalog, and agenttoll as stable top-level fields in both OpenAPI and Bazaar.",
      "Keep nested report objects extensible instead of freezing optional or provider-dependent subfields.",
      "Keep the Bazaar example schema-valid and prove OpenAPI-to-Bazaar required-field parity.",
    ],
    scope: [
      "Open free repair PR 4 aligns only those five stable top-level fields across OpenAPI and Bazaar.",
      "Focused schema, example, and parity tests for POST /paid/x402/market-radar.",
      "No request, price, network, asset, recipient, handler, payment, or settlement behavior change.",
    ],
    boundaries: [
      "No credential, wallet, signature, paid request, or target payment was used to reproduce this finding.",
      "Open free repair PR 4 is not paid delivery, settled revenue, or evidence of independent use.",
    ],
    evidence: [
      { label: "Live AgentToll service", href: "https://agenttoll.dev" },
      {
        label: "Open free repair PR 4",
        href: "https://github.com/huwhitememes/tollbooth/pull/4",
      },
      {
        label: "Public MIT handler source",
        href: "https://github.com/huwhitememes/tollbooth",
      },
    ],
  },
  {
    id: "argonaut-ecb-fx-reference-20260902",
    seller: "ArgonautWorks ECB FX Reference",
    origin: "https://official-fx-reference.vercel.app",
    route: "/api/v1/convert",
    method: "POST",
    routeClass: "paid_post",
    observedAt: "2026-09-02",
    livePrice: "0.0015 USDC on Base",
    summary:
      "The live GET and POST conversion route returns ECB provenance and cache state, but its success contract does not require the nested source and cache fields a buyer needs before payment.",
    observedContract: [
      "The live unpaid GET and POST route requires 0.0015 USDC on Base for /api/v1/convert.",
      "OpenAPI already requires the source and cache parent objects but does not require source.provider, source.dataset, source.url, source.available_free, cache.stale, or cache.age_ms.",
      "The public MIT handler sets all six nested fields on every successful conversion response.",
    ],
    requiredContract: [
      "Require source.provider, source.dataset, source.url, and source.available_free inside the existing source object.",
      "Require cache.stale and cache.age_ms inside the existing cache object.",
      "Keep the repair limited to the existing GET and POST conversion success contract without changing optional fields or failure branches.",
    ],
    scope: [
      "Open free repair PR 3 requires only those six handler-owned nested fields for /api/v1/convert.",
      "Focused OpenAPI and runtime-source tests cover the GET and POST conversion contract.",
      "No request, price, network, asset, recipient, handler, payment, or settlement behavior change.",
    ],
    boundaries: [
      "No credential, wallet, signature, paid request, or target payment was used to reproduce this finding.",
      "Open free repair PR 3 is not merged or deployed and does not establish buyer use, payment, demand, or revenue.",
    ],
    evidence: [
      {
        label: "Live unpaid 402 route",
        href: "https://official-fx-reference.vercel.app/api/v1/convert?base=USD&quote=EUR&amount=1",
      },
      {
        label: "Open free repair PR 3",
        href: "https://github.com/ArgonautWorks/ecb-fx-reference/pull/3",
      },
      {
        label: "Public MIT handler source",
        href: "https://github.com/ArgonautWorks/ecb-fx-reference",
      },
    ],
  },
] satisfies readonly SellerRepairBrief[]);

const briefsById = new Map(sellerRepairBriefs.map((brief) => [brief.id, brief]));

export function findSellerRepairBrief(id: string | null): SellerRepairBrief | null {
  if (!id) return null;
  return briefsById.get(id) ?? null;
}

export function sellerRepairBriefUrl(id: string): string {
  return `https://samedaydesk.com/x402/seller-conformance/?finding=${encodeURIComponent(id)}`;
}

export function sellerRepairScopeMailto(brief: SellerRepairBrief): string {
  const subject = `Seller repair scope: ${brief.id}`;
  const body = [
    `Finding ID: ${brief.id}`,
    `Seller origin: ${brief.origin}`,
    `Route: ${brief.method} ${brief.route}`,
    `Public brief: ${sellerRepairBriefUrl(brief.id)}`,
    "",
    "I approve the fixed one-route $490 scope. Repository:",
    "",
    "Or send the free schema proposal first.",
  ].join("\n");
  return `mailto:contact@samedaydesk.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

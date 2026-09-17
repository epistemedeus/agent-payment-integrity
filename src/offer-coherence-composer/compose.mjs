import { createHash } from "node:crypto";

import {
  SCHEMAS as POLICY_SCHEMAS,
  evaluateOfferCoherence,
  evaluateResponseContract,
  normalizeRequest,
} from "agent-payment-policy-015";

import { auditIntegrity, buildAuditTarget, parseX402Challenge, requestPinned } from "../../integrity.mjs";

export const SCHEMA_VERSION = "agent-payment-integrity.offer-handler-coherence.v1";
export const TOOL_VERSION = "0.1.0-candidate.12";
export const USDC_DECIMALS = 6;

const JSON_POINTER_ESCAPE = { "~1": "/", "~0": "~" };

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function sha256Bytes(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function jsonPointer(document, pointer) {
  if (pointer === "" || pointer === "#") return document;
  if (!pointer.startsWith("#/")) return undefined;
  let current = document;
  for (const raw of pointer.slice(2).split("/")) {
    const key = raw.replace(/~1/g, JSON_POINTER_ESCAPE["~1"]).replace(/~0/g, JSON_POINTER_ESCAPE["~0"]);
    if (!isPlainObject(current) && !Array.isArray(current)) return undefined;
    current = current[key];
  }
  return current;
}

export function resolveLocalRef(document, node, seen = new Set()) {
  if (Array.isArray(node)) return node.map((item) => resolveLocalRef(document, item, seen));
  if (!isPlainObject(node)) return node;
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
    if (seen.has(node.$ref)) return { $ref: node.$ref };
    const target = jsonPointer(document, node.$ref);
    if (!isPlainObject(target) && !Array.isArray(target)) return { $ref: node.$ref };
    const nextSeen = new Set(seen);
    nextSeen.add(node.$ref);
    const resolved = resolveLocalRef(document, target, nextSeen);
    const overlay = { ...node };
    delete overlay.$ref;
    if (isPlainObject(resolved)) return resolveLocalRef(document, { ...resolved, ...overlay }, nextSeen);
    return resolved;
  }
  const copy = {};
  for (const [key, value] of Object.entries(node)) {
    copy[key] = key === "example" || key === "examples" ? value : resolveLocalRef(document, value, seen);
  }
  return copy;
}

function schemaTypes(schema) {
  if (!isPlainObject(schema)) return [];
  if (typeof schema.type === "string") return [schema.type];
  return asArray(schema.type).filter((type) => typeof type === "string");
}

function objectBranches(schema) {
  if (!isPlainObject(schema)) return [];
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    return schema.oneOf.flatMap((branch) => objectBranches(branch));
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
    return schema.anyOf.flatMap((branch) => objectBranches(branch));
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    const merged = { type: "object", properties: {}, required: [] };
    for (const part of schema.allOf) {
      for (const branch of objectBranches(part)) {
        Object.assign(merged.properties, isPlainObject(branch.properties) ? branch.properties : {});
        merged.required.push(...asArray(branch.required));
      }
    }
    merged.required = uniqueSorted(merged.required);
    return [merged];
  }
  if (schemaTypes(schema).includes("object") || isPlainObject(schema.properties) || Array.isArray(schema.required)) {
    return [schema];
  }
  return [];
}

function intersectRequiredFields(branches) {
  if (!branches.length) return [];
  let required = null;
  for (const branch of branches) {
    const fields = new Set(asArray(branch.required).filter((field) => typeof field === "string"));
    required = required === null ? fields : new Set([...required].filter((field) => fields.has(field)));
  }
  return uniqueSorted([...(required || [])]);
}

export function jsonMedia(content) {
  if (!isPlainObject(content)) return null;
  const key = Object.keys(content).find((item) => item.toLowerCase().split(";", 1)[0].trim() === "application/json");
  return key ? { key, media: content[key] } : null;
}

export function operationAt(document, route, method) {
  const item = document?.paths?.[route];
  return isPlainObject(item) ? item[String(method).toLowerCase()] : null;
}

function resolveParameter(document, parameter) {
  if (!isPlainObject(parameter)) return null;
  if (typeof parameter.$ref === "string" && parameter.$ref.startsWith("#/")) {
    const resolved = resolveLocalRef(document, parameter);
    return isPlainObject(resolved) ? resolved : null;
  }
  return parameter;
}

function operationParameters(document, route, method) {
  const item = document?.paths?.[route];
  const operation = isPlainObject(item) ? item[String(method).toLowerCase()] : null;
  const merged = new Map();
  for (const parameter of [...asArray(item?.parameters), ...asArray(operation?.parameters)]) {
    const resolved = resolveParameter(document, parameter);
    if (!resolved || typeof resolved.name !== "string") continue;
    merged.set(`${resolved.in}:${resolved.name}`, resolved);
  }
  return [...merged.values()];
}

function resolvedRequestBody(document, operation) {
  if (!isPlainObject(operation?.requestBody)) return null;
  const resolved = resolveLocalRef(document, operation.requestBody);
  return isPlainObject(resolved) ? resolved : null;
}

function catalogX402Terms(document, route, method) {
  const operation = operationAt(document, route, method);
  const paymentInfo = isPlainObject(operation?.["x-payment-info"]) ? operation["x-payment-info"] : {};
  const x402 = asArray(paymentInfo.protocols)
    .map((item) => (isPlainObject(item) ? item.x402 : null))
    .find((item) => isPlainObject(item)) || {};
  const network = typeof x402.network === "string" && x402.network ? x402.network : null;
  const asset = typeof x402.asset === "string" && x402.asset ? x402.asset : null;
  const recipient = [x402.payTo, x402.recipient, paymentInfo.payTo, paymentInfo.recipient]
    .find((value) => typeof value === "string" && value);
  return { network, asset, recipient: recipient || null };
}

export function openApiInputNames(document, route, method) {
  const operation = operationAt(document, route, method);
  if (!isPlainObject(operation)) return [];
  const names = [];
  for (const parameter of operationParameters(document, route, method)) {
    if (parameter?.required !== true) continue;
    if (parameter.in === "query" || parameter.in === "path") names.push(String(parameter.name || ""));
  }
  const json = jsonMedia(resolvedRequestBody(document, operation)?.content)?.media;
  if (json?.schema) {
    const resolved = resolveLocalRef(document, json.schema);
    names.push(...intersectRequiredFields(objectBranches(resolved)));
  }
  return uniqueSorted(names);
}

export function bazaarInputNames(bazaar) {
  if (!isPlainObject(bazaar)) return [];
  const input = bazaar?.schema?.properties?.input;
  if (!isPlainObject(input)) return [];
  const queryRequired = asArray(input?.properties?.queryParams?.required);
  const bodyRequired = asArray(input?.properties?.body?.required);
  return uniqueSorted([...queryRequired, ...bodyRequired].map((name) => String(name)));
}

export function bazaarApplicationRequiredFields(bazaar) {
  if (!isPlainObject(bazaar)) return [];
  const exampleSchema = bazaar?.schema?.properties?.output?.properties?.example;
  if (!isPlainObject(exampleSchema)) return [];
  return uniqueSorted(asArray(exampleSchema.required).map((name) => String(name)));
}

export function bazaarOutputWrapperRequired(bazaar) {
  if (!isPlainObject(bazaar)) return [];
  return uniqueSorted(asArray(bazaar?.schema?.properties?.output?.required).map((name) => String(name)));
}

export function successResponseDeclaration(document, route, method) {
  const operation = operationAt(document, route, method);
  const responses = isPlainObject(operation?.responses) ? operation.responses : {};
  const status = Object.keys(responses).filter((key) => /^2\d\d$/.test(key)).sort()[0];
  const json = jsonMedia(responses?.[status]?.content);
  if (!status || !json) {
    return { status: 200, mediaType: "application/json", schema: null };
  }
  const rawSchema = isPlainObject(json.media.schema) ? json.media.schema : null;
  const schema = rawSchema ? resolveLocalRef(document, rawSchema) : null;
  let example = json.media.example;
  if (example === undefined) {
    const first = Object.values(isPlainObject(json.media.examples) ? json.media.examples : {})
      .find((item) => isPlainObject(item) && item.value !== undefined);
    example = first?.value;
  }
  return {
    status: Number(status),
    mediaType: "application/json",
    schema,
    ...(example === undefined ? {} : { example }),
  };
}

export function openApiRequiredSuccessFields(document, route, method) {
  const declaration = successResponseDeclaration(document, route, method);
  if (!isPlainObject(declaration.schema)) return [];
  return intersectRequiredFields(objectBranches(declaration.schema));
}

const RESPONSE_DECISION_RANK = { invalid: 3, partial: 2, absent: 1, admissible: 0 };

export function evaluateOpenApiResponseContract(document, origin, route, method) {
  const declaration = successResponseDeclaration(document, route, method);
  const request = { method, url: new URL(route, origin).toString() };
  const branches = isPlainObject(declaration.schema) ? objectBranches(declaration.schema) : [];
  const schemas = branches.length ? branches : [declaration.schema];
  const reports = schemas.map((schema) => evaluateResponseContract({
    schemaVersion: POLICY_SCHEMAS.responseContractObservation,
    source: "seller_openapi",
    request,
    response: {
      status: declaration.status,
      mediaType: declaration.mediaType,
      schema,
      ...(branches.length === 1 && declaration.example !== undefined ? { example: declaration.example } : {}),
    },
  }));
  const worst = reports.reduce((leader, report) => (
    (RESPONSE_DECISION_RANK[report.decision] || 0) > (RESPONSE_DECISION_RANK[leader.decision] || 0)
      ? report
      : leader
  ));
  const requiredFields = intersectRequiredFields(branches);
  return {
    ...worst,
    requiredFields,
    requiredPaths: uniqueSorted(reports.flatMap((report) => report.requiredPaths).filter((path) => requiredFields.includes(path.split(".")[0]))),
  };
}

export function decimalUsdToAtomic(value, decimals = USDC_DECIMALS) {
  const text = String(value ?? "").trim();
  const match = /^(0|[1-9][0-9]{0,16})(?:\.([0-9]{1,18}))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] || "";
  if (fraction.length > decimals) return null;
  const whole = BigInt(match[1]);
  const frac = BigInt(fraction.padEnd(decimals, "0") || "0");
  return String(whole * (10n ** BigInt(decimals)) + frac);
}

function examplePriceAtomic(document, route, method, bazaar) {
  const fromBazaar = bazaar?.info?.output?.example?.meta?.cost_usdc
    ?? bazaar?.info?.output?.example?.cost_usdc
    ?? bazaar?.info?.output?.example?.costDollars?.total;
  if (fromBazaar !== undefined && fromBazaar !== null && fromBazaar !== "") {
    const atomic = typeof fromBazaar === "number"
      ? decimalUsdToAtomic(String(fromBazaar))
      : decimalUsdToAtomic(fromBazaar);
    if (atomic !== null) {
      return { atomic, source: "bazaar_output_example" };
    }
  }
  const operation = operationAt(document, route, method);
  const declared = operation?.["x-payment-info"]?.price?.amount;
  if (declared !== undefined && declared !== null && declared !== "") {
    const atomic = decimalUsdToAtomic(declared);
    if (atomic !== null) return { atomic, source: "openapi_x_payment_info" };
  }
  const example = successResponseDeclaration(document, route, method).example;
  const fromOpenApi = example?.meta?.cost_usdc ?? example?.costDollars?.total;
  if (fromOpenApi !== undefined && fromOpenApi !== null && fromOpenApi !== "") {
    const atomic = typeof fromOpenApi === "number"
      ? decimalUsdToAtomic(String(fromOpenApi))
      : decimalUsdToAtomic(fromOpenApi);
    if (atomic !== null) return { atomic, source: "openapi_example" };
  }
  return { atomic: null, source: null };
}

function x402ExpiresAt(challenge, headers, now) {
  const header = headers?.["www-authenticate"] || "";
  const match = /expires="([^"]+)"/.exec(header);
  if (match) {
    const parsed = Date.parse(match[1]);
    if (Number.isFinite(parsed) && parsed > now) return new Date(parsed).toISOString();
  }
  const timeout = Number(challenge?.accepts?.[0]?.maxTimeoutSeconds);
  if (Number.isInteger(timeout) && timeout > 0) return new Date(now + timeout * 1000).toISOString();
  return new Date(now + 300_000).toISOString();
}

function sanitizeChallenge(challenge) {
  if (!isPlainObject(challenge)) return null;
  const resource = isPlainObject(challenge.resource) ? {
    url: challenge.resource.url,
    ...(challenge.resource.description ? { description: challenge.resource.description } : {}),
    ...(challenge.resource.mimeType ? { mimeType: challenge.resource.mimeType } : {}),
  } : undefined;
  const accepts = asArray(challenge.accepts)
    .filter((offer) => offer?.scheme === "exact")
    .map((offer) => ({
      scheme: "exact",
      network: offer.network,
      amount: offer.amount,
      asset: offer.asset,
      payTo: offer.payTo || offer.recipient,
      maxTimeoutSeconds: offer.maxTimeoutSeconds ?? 300,
      ...(isPlainObject(offer.extra) ? { extra: {
        ...(offer.extra.name ? { name: offer.extra.name } : {}),
        ...(offer.extra.version ? { version: offer.extra.version } : {}),
      } } : {}),
    }));
  const bazaar = challenge?.extensions?.bazaar;
  return {
    x402Version: 2,
    ...(challenge.error ? { error: challenge.error } : {}),
    ...(resource ? { resource } : {}),
    accepts,
    ...(isPlainObject(bazaar) ? { extensions: { bazaar } } : {}),
  };
}

function paymentRequiredHeader(challenge) {
  const sanitized = sanitizeChallenge(challenge);
  if (!sanitized) return null;
  return Buffer.from(JSON.stringify(sanitized)).toString("base64url");
}

function fixtureRequestImpl(observation) {
  const openapiBody = Buffer.from(JSON.stringify(observation.openapi));
  const challenge = observation.runtime?.challenge || null;
  const header = paymentRequiredHeader(challenge);
  const routeBody = Buffer.from(JSON.stringify(challenge || { error: "no runtime challenge" }));
  return async (urlInput) => {
    const url = new URL(urlInput);
    if (url.pathname.endsWith("/openapi.json") || url.pathname.endsWith("/mpp-openapi.json")) {
      if (url.pathname.endsWith("/mpp-openapi.json") && !observation.mppOpenapi) {
        return { status: 404, headers: { "content-type": "text/plain" }, body: Buffer.from("not found") };
      }
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: url.pathname.endsWith("/mpp-openapi.json")
          ? Buffer.from(JSON.stringify(observation.mppOpenapi))
          : openapiBody,
      };
    }
    if (observation.method === "POST") {
      throw new Error("composer does not transmit seller POST");
    }
    if (!header) {
      return { status: 500, headers: { "content-type": "application/json" }, body: Buffer.from("{}") };
    }
    return {
      status: 402,
      headers: {
        "content-type": "application/json",
        "payment-required": header,
      },
      body: routeBody,
    };
  };
}

function collectFindings({
  method,
  integrity,
  offerCoherence,
  responseContract,
  inputNames,
  successPaths,
  examplePrice,
  requestBinding,
}) {
  const findings = [];
  if (integrity) {
    for (const route of asArray(integrity.routes)) {
      findings.push(...asArray(route.findings));
    }
    if (integrity.ok !== true) findings.push("integrity_not_ok");
    if (method === "GET" && integrity.machineBuyable !== true) findings.push("not_machine_buyable");
  }
  if (offerCoherence?.decision === "drifted") {
    findings.push(`offer_coherence_drifted:${(offerCoherence.drifted || []).join(",") || "unknown"}`);
  }
  if (responseContract?.decision && responseContract.decision !== "admissible") {
    findings.push(`seller_response_contract_${responseContract.decision}`);
  }
  if (inputNames && !inputNames.matched) {
    findings.push("openapi_bazaar_input_name_mismatch");
  }
  for (const path of asArray(successPaths?.missingFromBazaar)) {
    findings.push(`openapi_required_path_missing_from_bazaar:${path}`);
  }
  if (successPaths?.bazaarWrapperOnly) findings.push("bazaar_output_wrapper_only");
  if (method === "GET") {
    if (!examplePrice?.exampleAtomic) findings.push("example_price_missing");
    else if (!examplePrice?.runtimeAtomic) findings.push("runtime_amount_missing");
    else if (examplePrice.matched === false) findings.push("example_price_runtime_amount_mismatch");
  } else if (examplePrice && examplePrice.matched === false) {
    findings.push("example_price_runtime_amount_mismatch");
  }
  if (requestBinding && requestBinding.matched === false) {
    findings.push("canonical_get_binding_mismatch");
  }
  return uniqueSorted(findings);
}

function publicInputNames(openapiNames, bazaarNames) {
  const openapi = uniqueSorted(openapiNames);
  const bazaar = uniqueSorted(bazaarNames);
  const matched = openapi.length === bazaar.length && openapi.every((name, index) => name === bazaar[index]);
  return {
    openapi,
    bazaar,
    matched,
    drifted: matched ? [] : {
      onlyOpenApi: uniqueSorted(openapi.filter((name) => !bazaar.includes(name))),
      onlyBazaar: uniqueSorted(bazaar.filter((name) => !openapi.includes(name))),
    },
  };
}

export async function composeOfferHandlerCoherence(observation, {
  now = Date.now(),
  requestImpl = null,
  requireBazaar = true,
} = {}) {
  if (!isPlainObject(observation)) throw new Error("observation is required");
  const origin = observation.origin;
  const method = String(observation.method || "GET").toUpperCase();
  const route = observation.route;
  const url = observation.url;
  if (!origin || !route || !url) throw new Error("origin, route, and url are required");
  if (!["GET", "POST"].includes(method)) throw new Error("method must be GET or POST");
  if (method === "POST" && requestImpl === null && observation.runtime == null && observation.catalogBazaar == null) {
    throw new Error("POST sellers are not probed; pin OpenAPI and Bazaar in a fixture");
  }

  const document = observation.openapi;
  if (!isPlainObject(document)) throw new Error("OpenAPI document is required");

  const bazaar = observation.catalogBazaar
    || observation.runtime?.challenge?.extensions?.bazaar
    || null;

  const inputNames = publicInputNames(
    openApiInputNames(document, route, method),
    bazaarInputNames(bazaar),
  );
  const openapiRequired = openApiRequiredSuccessFields(document, route, method);
  const bazaarRequired = bazaarApplicationRequiredFields(bazaar);
  const wrapperRequired = bazaarOutputWrapperRequired(bazaar);
  const missingFromBazaar = openapiRequired.filter((field) => !bazaarRequired.includes(field));
  const bazaarWrapperOnly = wrapperRequired.length === 1 && wrapperRequired[0] === "type" && bazaarRequired.length === 0;
  const successPaths = {
    openapi: openapiRequired,
    bazaar: bazaarRequired,
    bazaarWrapper: wrapperRequired,
    missingFromBazaar,
    bazaarWrapperOnly,
  };

  const responseContract = evaluateOpenApiResponseContract(document, origin, route, method);

  let requestBinding = null;
  if (method === "GET") {
    const request = normalizeRequest("GET", url);
    const resourceUrl = observation.runtime?.challenge?.resource?.url;
    let resource = null;
    if (typeof resourceUrl === "string" && resourceUrl) {
      resource = normalizeRequest("GET", resourceUrl);
    }
    requestBinding = {
      publicRoute: request.publicRoute,
      queryKeys: [...request.queryKeys],
      bindingDigest: request.bindingDigest,
      resourceBindingDigest: resource?.bindingDigest ?? null,
      matched: resource ? resource.bindingDigest === request.bindingDigest : false,
      canonicalGetBytes: observation.runtime?.challenge
        ? sha256Bytes(Buffer.from(JSON.stringify(observation.runtime.challenge)))
        : null,
    };
  }

  const challenge = observation.runtime?.challenge || null;
  const runtimeAmount = challenge?.accepts?.[0]?.amount ? String(challenge.accepts[0].amount) : null;
  const example = examplePriceAtomic(document, route, method, bazaar);
  const examplePrice = {
    exampleAtomic: example.atomic,
    exampleSource: example.source,
    runtimeAtomic: runtimeAmount,
    matched: example.atomic !== null && runtimeAmount !== null ? example.atomic === runtimeAmount : null,
  };

  let offerCoherence = null;
  if (method === "GET" && runtimeAmount && example.atomic) {
    const accept = challenge.accepts.find((item) => item.scheme === "exact") || challenge.accepts[0];
    const expiresAt = x402ExpiresAt(challenge, observation.runtime?.headers, now);
    const catalogTerms = catalogX402Terms(document, route, method);
    offerCoherence = evaluateOfferCoherence({
      schemaVersion: POLICY_SCHEMAS.offerCoherenceObservation,
      catalog: {
        source: "openapi_or_bazaar_example",
        protocol: "x402",
        method: "GET",
        url,
        amountAtomic: example.atomic,
        ...(catalogTerms.network ? { network: catalogTerms.network } : {}),
        ...(catalogTerms.asset ? { asset: catalogTerms.asset } : {}),
        ...(catalogTerms.recipient ? { recipient: catalogTerms.recipient } : {}),
        expiresAt,
      },
      runtime: {
        protocol: "x402",
        method: "GET",
        url: challenge.resource?.url || url,
        amountAtomic: runtimeAmount,
        network: accept.network,
        asset: accept.asset,
        recipient: accept.payTo || accept.recipient,
        expiresAt,
      },
    }, { now });
  }

  let integrity = null;
  if (method === "GET") {
    integrity = await auditIntegrity({
      origin,
      x402Document: document,
      mppDocument: observation.mppOpenapi || null,
      requireBazaar,
      route,
      method,
      maxRoutes: 1,
      requestImpl: requestImpl || fixtureRequestImpl(observation),
    });
  } else {
    integrity = await auditIntegrity({
      origin,
      x402Document: document,
      requireBazaar: false,
      route,
      method: "POST",
      maxRoutes: 1,
      requestImpl: async () => {
        throw new Error("composer does not transmit seller POST");
      },
    });
  }

  const findings = collectFindings({
    method,
    integrity,
    offerCoherence,
    responseContract,
    inputNames,
    successPaths,
    examplePrice,
    requestBinding,
  });

  const liveGet = method === "GET" && !observation.fixture;
  const ok = findings.length === 0
    && (integrity?.ok === true)
    && (!liveGet || integrity?.machineBuyable === true);

  return {
    schemaVersion: SCHEMA_VERSION,
    toolVersion: TOOL_VERSION,
    checkedAt: new Date(now).toISOString(),
    ok,
    machineBuyable: integrity?.machineBuyable === true,
    origin,
    method,
    route,
    url,
    findings,
    inputNames,
    successPaths,
    examplePrice,
    requestBinding,
    responseContract: {
      decision: responseContract.decision,
      requiredFields: responseContract.requiredFields,
      requiredPaths: responseContract.requiredPaths,
      structuralProblems: responseContract.structuralProblems,
      exampleStatus: responseContract.exampleStatus,
    },
    offerCoherence: offerCoherence ? {
      decision: offerCoherence.decision,
      drifted: offerCoherence.drifted,
      matched: offerCoherence.matched,
      unknown: offerCoherence.unknown,
      nextAction: offerCoherence.nextAction,
    } : null,
    integrity: integrity ? {
      ok: integrity.ok,
      machineBuyable: integrity.machineBuyable,
      schemaVersion: integrity.schemaVersion,
      findings: asArray(integrity.routes).flatMap((entry) => asArray(entry.findings)),
      responseContractDecision: integrity.routes?.[0]?.responseContract?.decision ?? null,
    } : null,
    ignored: {
      bazaarCallCounts: observation.ignoredCatalogMetrics?.quality || null,
      bazaarCallCountsUsedAsConversion: false,
    },
    boundary: {
      credentialsUsed: false,
      paymentSigned: false,
      paymentSent: false,
      sellerPostTransmitted: false,
      handlerTypesInferred: false,
      twoCharges: false,
      bazaarCallCountsUsedAsConversion: false,
      policyOfferCoherenceCheckIsNotCiOracle: true,
      statement: "Fail-closed composition of OpenAPI input names, Bazaar in/out, unpaid 402, canonical GET binding, example price, and required success paths. It does not pay, sign, or treat catalog call counts as conversion.",
    },
  };
}

export function applyQueryExamples(document, route, method, requestUrl) {
  const copy = structuredClone(document);
  const operation = operationAt(copy, route, method);
  if (!operation || !Array.isArray(operation.parameters)) return copy;
  const url = new URL(requestUrl);
  for (const parameter of operation.parameters) {
    if (parameter?.in !== "query" || typeof parameter.name !== "string") continue;
    const value = url.searchParams.get(parameter.name);
    if (value !== null) parameter.example = value;
  }
  return copy;
}

export async function composeFromFixture(observation, options = {}) {
  return composeOfferHandlerCoherence({ ...observation, fixture: true }, options);
}

export async function composeLiveGet(target, {
  now = Date.now(),
  requestImpl = requestPinned,
  requireBazaar = true,
} = {}) {
  const url = new URL(target);
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) {
    throw new Error("url must be credential-free HTTPS on port 443");
  }
  const origin = url.origin;
  const route = url.pathname;
  const openapiResponse = await requestImpl(new URL("/openapi.json", origin), { accept: "application/json" });
  if (openapiResponse.status !== 200) throw new Error(`OpenAPI returned HTTP ${openapiResponse.status}`);
  const document = applyQueryExamples(
    JSON.parse(openapiResponse.body.toString("utf8")),
    route,
    "GET",
    url,
  );
  const operation = operationAt(document, route, "GET");
  if (!operation) throw new Error(`exact paid GET ${route} was not declared`);
  const { url: constructed } = buildAuditTarget(origin, route, operation);
  const probe = await requestImpl(constructed, { accept: "application/json" });
  if (probe.status !== 402) throw new Error(`expected unpaid HTTP 402, received ${probe.status}`);
  const parsed = parseX402Challenge(probe.headers?.["payment-required"]);
  if (parsed.error) throw new Error(parsed.error);
  return composeOfferHandlerCoherence({
    origin,
    method: "GET",
    route,
    url: constructed.toString(),
    openapi: document,
    runtime: {
      status: probe.status,
      headers: probe.headers,
      challenge: parsed.payload,
      bodyBytes: sha256Bytes(probe.body),
    },
  }, {
    now,
    requireBazaar,
    requestImpl: async (requestUrl) => {
      const next = new URL(requestUrl);
      if (next.pathname === "/openapi.json") return openapiResponse;
      if (next.pathname === route) return probe;
      throw new Error("composer refuses a second seller probe");
    },
  });
}

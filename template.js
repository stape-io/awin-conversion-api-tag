const BigQuery = require('BigQuery');
const computeEffectiveTldPlusOne = require('computeEffectiveTldPlusOne');
const encodeUriComponent = require('encodeUriComponent');
const getAllEventData = require('getAllEventData');
const getContainerVersion = require('getContainerVersion');
const getCookieValues = require('getCookieValues');
const getRequestHeader = require('getRequestHeader');
const getTimestampMillis = require('getTimestampMillis');
const getType = require('getType');
const JSON = require('JSON');
const logToConsole = require('logToConsole');
const makeInteger = require('makeInteger');
const makeNumber = require('makeNumber');
const makeString = require('makeString');
const parseUrl = require('parseUrl');
const sendHttpRequest = require('sendHttpRequest');
const setCookie = require('setCookie');

/*==============================================================================
==============================================================================*/

const traceId = getRequestHeader('trace-id');
const eventData = getAllEventData();
const useOptimisticScenario = isUIFieldTrue(data.useOptimisticScenario);

if (!isExecutionConsentGivenOrNotRequired()) {
  return data.gtmOnSuccess();
}

const url = eventData.page_location || getRequestHeader('referer');
if (url && url.lastIndexOf('https://gtm-msr.appspot.com/', 0) === 0) {
  return data.gtmOnSuccess();
}

const actionHandlers = {
  pageView: handlePageViewEvent,
  conversion: handleConversionEvent
};

const handler = actionHandlers[data.type];
if (handler) {
  handler(data, eventData);
} else {
  return data.gtmOnFailure();
}

if (useOptimisticScenario) {
  return data.gtmOnSuccess();
}

/*==============================================================================
  Vendor related functions
==============================================================================*/

function isConsentDeclined(data, eventData) {
  const cookieConsentDetection = data.cookieConsentDetection;

  if (!cookieConsentDetection) return false;

  const autoConsentParameter = data.cookieConsentAutoParameter;
  if (cookieConsentDetection === 'auto' && autoConsentParameter) {
    // Check consent state from Stape's Data Tag
    if (eventData.consent_state && eventData.consent_state[autoConsentParameter] === false) {
      return true;
    }

    // Check consent state from Google Consent Mode
    const gcsPositionMapping = { analytics_storage: 3, ad_storage: 2 };
    const xGaGcs = eventData['x-ga-gcs'] || ''; // x-ga-gcs is a string like "G110"
    if (xGaGcs[gcsPositionMapping[autoConsentParameter]] === '0') {
      return true;
    }
  } else if (cookieConsentDetection === 'manual') {
    // Check template field specific consent signal
    return ['0', 0, 'false', false].indexOf(data.cookieConsentManualValue) !== -1;
  }

  return false;
}

function parseClickIdFromUrl(eventData) {
  const url = eventData.page_location || getRequestHeader('referer');
  if (!url) return;

  const searchParams = parseUrl(url).searchParams;
  if (searchParams.awc || (searchParams.awaid && searchParams.gclid)) {
    const clickId = searchParams.awc
      ? searchParams.awc
      : 'gclid_' + searchParams.awaid + '_' + searchParams.gclid;
    return clickId;
  }
}

function getClickIdFromUIField(data) {
  return [data.clickIdAwc, data.clickIdSnAwc].filter((value) => value !== '0' && value).join(',');
}

function getClickIdFromCookie(data, eventData) {
  const commonCookie = eventData.commonCookie || {};
  const awinAwcCookie = getCookieValues('awin_awc')[0] || commonCookie.awin_awc;
  const awinAwcSnCookie = getCookieValues('awin_sn_awc')[0] || commonCookie.awin_sn_awc;
  const clickIdFromUrl = parseClickIdFromUrl(eventData);
  const isConsentNotDeclined = !isConsentDeclined(data, eventData);

  if (isConsentNotDeclined) {
    const awcFromCookie = [awinAwcCookie, awinAwcSnCookie]
      .filter((cookieValue) => cookieValue)
      .join(',');
    return awcFromCookie || clickIdFromUrl;
  } else if (data.enableCashbackTracking) {
    return awinAwcSnCookie || clickIdFromUrl;
  }

  return;
}

function parseDeduplicationParamFromUrl(data, eventData) {
  const url = eventData.page_location || getRequestHeader('referer');
  if (!url) return;

  const pageReferrerOrigin = (parseUrl(eventData.page_referrer) || {}).origin;
  const parsedUrl = parseUrl(url) || {};

  const urlSearchParams = parsedUrl.searchParams;

  // Always checks the URL parameters first.
  if (
    data.considerAwinClickIdsAsAwinSourceChannel &&
    (urlSearchParams.awaid || urlSearchParams.awc)
  ) {
    return 'aw';
  }

  const deduplicationParamNames = itemizeCommaSeparatedString(
    data.deduplicationQueryParameterNames || 'source'
  );
  const awinSourceValues = itemizeCommaSeparatedString(data.awinSourceValues || 'awin,aw');
  let foundOtherPaidSource = false;
  for (const param of deduplicationParamNames) {
    const value = urlSearchParams[param];
    if (value) {
      if (awinSourceValues.indexOf(value) !== -1) {
        return 'aw';
      }
      foundOtherPaidSource = true;
    }
  }
  if (foundOtherPaidSource) {
    return 'other';
  }

  // Internal navigation. Abort.
  // This check must happen after checking for URL parameters to account for website redirection problems after clicking on an ad.
  if (
    pageReferrerOrigin &&
    pageReferrerOrigin.indexOf(computeEffectiveTldPlusOne(parsedUrl.hostname)) !== -1
  ) {
    return;
  }

  if (data.includeOrganicTraffic) {
    // prettier-ignore
    const organicSources = [
      'google.', 'bing.', 'yahoo.', 'yandex.', 'duckduckgo.', 'baidu.', 'naver.', 'qwant.', 'ask.'
    ];
    const customOrganicSources = itemizeCommaSeparatedString(data.customOrganicSources || '');
    customOrganicSources.forEach((p) => organicSources.push(p));

    const isOrganicTraffic = organicSources.some(
      (organicSource) => pageReferrerOrigin && pageReferrerOrigin.indexOf(organicSource) !== -1
    );
    if (isOrganicTraffic) {
      return 'organic';
    }
  }

  return 'direct';
}

function getDeduplicationParamFromCookie(data, eventData) {
  if (isConsentDeclined(data, eventData) && !data.enableCashbackTracking) return;
  return getCookieValues('awin_source')[0] || (eventData.commonCookie || {}).awin_source;
}

function handlePageViewEvent(data, eventData) {
  const url = eventData.page_location || getRequestHeader('referer');

  const searchParams = (parseUrl(url) || {}).searchParams;
  const isJourneyExemptFromConsent = !!(data.enableCashbackTracking && searchParams.sn === '1');
  const isConsentNotDeclined = !isConsentDeclined(data, eventData);

  if (isJourneyExemptFromConsent || isConsentNotDeclined) {
    const cookieOptions = {
      domain: data.cookieDomain || 'auto',
      samesite: 'Lax',
      path: '/',
      secure: true,
      httpOnly: !!data.cookieHttpOnly,
      'max-age': 60 * 60 * 24 * (makeInteger(data.cookieExpiration) || 365)
    };

    const clickId = parseClickIdFromUrl(eventData);
    if (clickId) {
      const awcCookieName = isJourneyExemptFromConsent ? 'awin_sn_awc' : 'awin_awc';
      setCookie(awcCookieName, clickId, cookieOptions, false);
    }

    const deduplicationCookie = getDeduplicationParamFromCookie(data, eventData);
    const deduplicationParamValue = parseDeduplicationParamFromUrl(data, eventData);
    const shouldOverwriteCookie = !!(
      deduplicationCookie &&
      deduplicationParamValue &&
      deduplicationParamValue !== 'direct'
    );

    if (deduplicationParamValue && (!deduplicationCookie || shouldOverwriteCookie)) {
      setCookie('awin_source', deduplicationParamValue, cookieOptions, false);
    }
  }

  return data.gtmOnSuccess();
}

function addCommissionGroupsData(data, order) {
  let commissionGroups;

  const dataCommissionGroupsType = getType(data.commissionGroups);
  if (dataCommissionGroupsType === 'array') {
    commissionGroups = data.commissionGroups;
  } else if (dataCommissionGroupsType === 'string') {
    const isCommissionGroupAndAmountDefined = data.commissionGroups.indexOf(':') !== -1;
    if (isCommissionGroupAndAmountDefined) {
      commissionGroups = data.commissionGroups.split('|').map((cg) => {
        const split = cg.split(':');
        const code = split[0];
        const amount = split[1];
        return { code: code, amount: makeNumber(amount) };
      });
    } else if (!isCommissionGroupAndAmountDefined && order.amount) {
      commissionGroups = [{ code: data.commissionGroups, amount: order.amount }];
    }
  } else {
    commissionGroups = [{ code: 'DEFAULT', amount: order.amount }];
  }

  order.commissionGroups = commissionGroups;

  return order;
}

function addBasketData(data, eventData, order) {
  let basket = data.hasOwnProperty('basket') ? data.basket : eventData.items || [];
  if (getType(basket) === 'string') basket = JSON.parse(basket);

  if (getType(basket) === 'array' && basket.length > 0) {
    const basketForPLT = [];
    basket.forEach((item) => {
      const productForPLT = {};

      // Required

      const id = item.item_id || item.id;
      if (id) productForPLT.id = productForPLT.sku = makeString(id);

      const name = item.item_name || item.name;
      if (name) productForPLT.name = makeString(name);

      if (isValidValue(item.price)) productForPLT.price = makeNumber(item.price);

      if (item.quantity) productForPLT.quantity = makeInteger(item.quantity);

      // Optional

      const category = item.item_category || item.category;
      if (category) productForPLT.category = makeString(category);

      const sku = item.item_sku || item.sku;
      if (sku) productForPLT.sku = makeString(sku);

      const commissionGroupCode = item.commission_group_code || item.commissionGroupCode;
      productForPLT.commissionGroupCode = commissionGroupCode
        ? makeString(commissionGroupCode)
        : 'DEFAULT';

      basketForPLT.push(productForPLT);
    });

    order.basket = basketForPLT;
  }

  return order;
}

function addCustomParameters(data, order) {
  const customParameters = {
    1: 'gtm_s2s_stape_' + getContainerVersion().containerId
  };

  if (data.customParameters) {
    data.customParameters.forEach((d) => {
      const key = d.key;
      const value = d.value;
      if (key === '1' || !isValidValue(key) || !isValidValue(value)) return;
      customParameters[key] = value;
    });
  }

  order.custom = customParameters;

  return order;
}

function mapRequestData(data, eventData) {
  const order = {};
  const requestData = {
    orders: [order]
  };

  // Required

  const orderReference =
    data.orderReference || eventData.orderId || eventData.order_id || eventData.transaction_id;
  if (isValidValue(orderReference)) order.orderReference = makeString(orderReference);

  if (isValidValue(data.amount)) order.amount = makeNumber(data.amount);
  else if (isValidValue(eventData.value)) order.amount = makeNumber(eventData.value);

  const currency = data.currency || eventData.currency || eventData.currencyCode;
  if (currency) order.currency = makeString(currency);

  const channel = data.hasOwnProperty('channel')
    ? data.channel
    : getDeduplicationParamFromCookie(data, eventData) || 'aw';
  if (channel) order.channel = makeString(channel);

  addCommissionGroupsData(data, order);

  // Required - any of

  const voucher = data.hasOwnProperty('voucher') ? data.voucher : eventData.coupon;
  if (voucher) order.voucher = makeString(voucher);

  const clickId =
    data.hasOwnProperty('clickIdAwc') || data.hasOwnProperty('clickIdSnAwc')
      ? getClickIdFromUIField(data)
      : getClickIdFromCookie(data, eventData);
  if (clickId) order.awc = clickId;

  if (data.publisherId) order.publisherId = makeInteger(data.publisherId);
  if (data.clickTime) order.clickTime = makeInteger(data.clickTime);

  // Optional

  if (data.customerAcquisition) order.customerAcquisition = data.customerAcquisition;

  if (data.transactionTime) order.transactionTime = makeInteger(data.transactionTime);

  order.isTest = isUIFieldTrue(data.isTest);

  addBasketData(data, eventData, order);

  addCustomParameters(data, order);

  if (data.webhookUrl) requestData.webhook = { url: data.webhookUrl };

  return requestData;
}

function areThereRequiredParametersMissing(requestData) {
  const baseRequiredParameters = [
    'orderReference',
    'amount',
    'currency',
    'commissionGroups',
    'channel'
  ];
  const anyBaseParameterMissing = baseRequiredParameters.some((p) => {
    const value = requestData.orders[0][p];
    return !isValidValue(value);
  });
  if (anyBaseParameterMissing) return baseRequiredParameters;

  const attributionParameters = ['awc', 'voucher', ['publisherId', 'clickTime']];
  const anyAttributionParameterMissing = attributionParameters.every((p) => {
    const value = requestData.orders[0];
    if (getType(p) === 'array') {
      return p.some((i) => !isValidValue(value[i]));
    } else {
      return !isValidValue(value[p]);
    }
  });
  if (anyAttributionParameterMissing) return attributionParameters;

  const pltRequiredParameters = ['id', 'name', 'price', 'quantity'];
  const basket = requestData.orders[0].basket;
  if (getType(basket) === 'array' && basket.length > 0) {
    const anyPLTRequiredParametersMissing = basket.some((i) => {
      return pltRequiredParameters.some((p) => {
        const value = i[p];
        return !isValidValue(value);
      });
    });
    if (anyPLTRequiredParametersMissing) return pltRequiredParameters;
  }
}

function handleConversionEvent(data, eventData) {
  const requestData = mapRequestData(data, eventData);

  const missingParameters = areThereRequiredParametersMissing(requestData);
  if (missingParameters) {
    log({
      Name: 'AwinConversionApi',
      Type: 'Message',
      TraceId: traceId,
      EventName: data.type,
      Message: 'Request was not sent.',
      Reason: 'One or more required parameters are missing: ' + missingParameters.join(' or ')
    });

    return data.gtmOnFailure();
  }

  return sendRequest(data, requestData);
}

function generateRequestUrl(data) {
  return 'https://api.awin.com/s2s/advertiser/' + enc(data.advertiserId) + '/orders';
}

function generateRequestOptions(data) {
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': data.apiKey
    }
  };

  return options;
}

function sendRequest(data, requestData) {
  const requestUrl = generateRequestUrl(data);
  const requestOptions = generateRequestOptions(data);

  log({
    Name: 'AwinConversionApi',
    Type: 'Request',
    TraceId: traceId,
    EventName: data.type,
    RequestMethod: requestOptions.method,
    RequestUrl: requestUrl,
    RequestBody: requestData
  });

  return sendHttpRequest(
    requestUrl,
    (statusCode, headers, body) => {
      log({
        Name: 'AwinConversionApi',
        Type: 'Response',
        TraceId: traceId,
        EventName: data.type,
        ResponseStatusCode: statusCode,
        ResponseHeaders: headers,
        ResponseBody: body
      });

      if (!useOptimisticScenario) {
        if (statusCode >= 200 && statusCode < 300) {
          data.gtmOnSuccess();
        } else {
          data.gtmOnFailure();
        }
      }
    },
    requestOptions,
    JSON.stringify(requestData)
  );
}

/*==============================================================================
  Helpers
==============================================================================*/

function enc(data) {
  return encodeUriComponent(makeString(data || ''));
}

function itemizeCommaSeparatedString(data) {
  if (getType(data) !== 'string') return;
  return data
    .split(',')
    .filter((p) => p)
    .map((p) => p.trim());
}

function isValidValue(value) {
  const valueType = getType(value);
  return valueType !== 'null' && valueType !== 'undefined' && value !== '';
}

function isUIFieldTrue(field) {
  return [true, 'true'].indexOf(field) !== -1;
}

function isExecutionConsentGivenOrNotRequired() {
  if (data.adStorageConsent !== 'required') return true;
  if (eventData.consent_state) return !!eventData.consent_state.ad_storage;
  const xGaGcs = eventData['x-ga-gcs'] || ''; // x-ga-gcs is a string like "G110"
  return xGaGcs[2] === '1';
}

function log(rawDataToLog) {
  const logDestinationsHandlers = {};
  if (determinateIsLoggingEnabled()) logDestinationsHandlers.console = logConsole;
  if (determinateIsLoggingEnabledForBigQuery()) logDestinationsHandlers.bigQuery = logToBigQuery;

  const keyMappings = {
    // No transformation for Console is needed.
    bigQuery: {
      Name: 'tag_name',
      Type: 'type',
      TraceId: 'trace_id',
      EventName: 'event_name',
      RequestMethod: 'request_method',
      RequestUrl: 'request_url',
      RequestBody: 'request_body',
      ResponseStatusCode: 'response_status_code',
      ResponseHeaders: 'response_headers',
      ResponseBody: 'response_body'
    }
  };

  for (const logDestination in logDestinationsHandlers) {
    const handler = logDestinationsHandlers[logDestination];
    if (!handler) continue;

    const mapping = keyMappings[logDestination];
    const dataToLog = mapping ? {} : rawDataToLog;

    if (mapping) {
      for (const key in rawDataToLog) {
        const mappedKey = mapping[key] || key;
        dataToLog[mappedKey] = rawDataToLog[key];
      }
    }

    handler(dataToLog);
  }
}

function logConsole(dataToLog) {
  logToConsole(JSON.stringify(dataToLog));
}

function logToBigQuery(dataToLog) {
  const connectionInfo = {
    projectId: data.logBigQueryProjectId,
    datasetId: data.logBigQueryDatasetId,
    tableId: data.logBigQueryTableId
  };

  dataToLog.timestamp = getTimestampMillis();

  ['request_body', 'response_headers', 'response_body'].forEach((p) => {
    dataToLog[p] = JSON.stringify(dataToLog[p]);
  });

  const bigquery =
    getType(BigQuery) === 'function' ? BigQuery() /* Only during Unit Tests */ : BigQuery;
  bigquery.insert(connectionInfo, [dataToLog], { ignoreUnknownValues: true });
}

function determinateIsLoggingEnabled() {
  const containerVersion = getContainerVersion();
  const isDebug = !!(
    containerVersion &&
    (containerVersion.debugMode || containerVersion.previewMode)
  );

  if (!data.logType) {
    return isDebug;
  }

  if (data.logType === 'no') {
    return false;
  }

  if (data.logType === 'debug') {
    return isDebug;
  }

  return data.logType === 'always';
}

function determinateIsLoggingEnabledForBigQuery() {
  if (data.bigQueryLogType === 'no') return false;
  return data.bigQueryLogType === 'always';
}

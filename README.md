# Awin Conversion API Tag for Google Tag Manager Server-Side

The **Awin Conversion API Tag** allows you to send conversion data directly from your server container to Awin's [Conversion API](https://developer.awin.com/apidocs/conversion-api), ensuring accurate, consent-aware, and cookie-independent tracking for affiliate conversions.

It supports both **Page View** events (for cookie creation) and **Conversion** events, with full support for deduplication logic, cashback flows, commission groups, product-level tracking, and enhanced logging.

- **Page View**: Captures Awin tracking parameters from the URL and saves them as cookies for later use.
- **Conversion**: Sends a server-to-server request (postback) with conversion data to Awin, using information from cookies or event data.

## How to use the Awin Conversion API Tag

1. Add the **Awin Conversion API Tag** to your server container in GTM.
2. Select the **Action** you want to perform (`Page View` or `Conversion`).
3. For `Page View` actions, the tag will automatically parse URL parameters and set the necessary cookies. This action should fire on all landing pages.
4. For `Conversion` actions, fill in your `Advertiser ID`, `API Key`, and the required conversion parameters.
5. Add triggers to fire the tag based on the selected action (e.g., all page views for the "Page View" action, purchase events for the "Conversion" action).

## Actions

### Page View

When the action is set to `Page View`, the tag's primary role is to capture attribution data from the landing page URL and store it in first-party cookies. This information is then used by the `Conversion` action to correctly attribute sales.

The tag captures two key pieces of information:

1.  **Click IDs**: It looks for Awin's click identifiers in the URL.
    - `awc`: The standard Awin Click ID.
    - `awaid` and `gclid`: Awin and Google Click IDs used together for specific tracking scenarios.
    - These values are stored in the `awin_awc` cookie; or `awin_sn_awc` cookie, if `sn=1` is present in the URL and the _Unconditional Cashback & Rewards Tracking_ checkbox is enabled.

2.  **Last Click Referrer Channel**: Also known as the Deduplication Channel, this determines the source of the traffic to prevent duplicate commissions. The tag analyzes URL parameters (like `source`, `utm_source`, `gclid`, etc.) and the page referrer to determine the channel. The result is stored in the `awin_source` cookie and can be one of the following values:
    - `aw`: Set if an Awin source value (e.g., "awin", "aw") is found in the deduplication parameters, or if an Awin Click ID is present in the URL (only if explicitly enabled).
    - `other`: Set if the deduplication parameters do not match any known Awin values, or if other tracking parameters (like `gclid`, `fbclid`) are found but are not identified as Awin traffic.
    - `organic`: Set if the traffic comes from a known search engine and no other paid channel parameters are present (only if explicitly enabled).
    - `direct`: Set if none of the other conditions are met.

### Conversion

When the action is set to `Conversion`, the tag sends the final transaction data to the Awin API via a server-to-server postback.

## Parameters (Conversion Action)

### Required Parameters

- **Advertiser ID**: Your Awin Advertiser ID.
- **API Key**: The OAuth2 Token, found in your Awin account on the `Awin API Credentials` page.
- **Order Reference**: A unique ID for the transaction.
- **Amount**: The total value of the conversion.
- **Currency**: The currency of the conversion.
- **Channel**: The channel responsible for the conversion (e.g., `aw`). It can be retrieved from the `awin_source` cookie set by the Page View action.

The tag also requires at least one of the following for attribution:

- **Awin Click ID (awc)**
- **Voucher Code**
- **Publisher ID** and **Click Time**

### Optional Parameters

- **Commission Groups**: Defines the commission structure for the order. This can be provided in several formats:
  - If left blank, the commission group `DEFAULT` and the _Amount_ field, as commission group value, will be used.
  - A single group name where the _Amount_ field is used as the commission value (e.g., `DVD`).
  - A full set of groups and their respective amounts (e.g., `CD:11.10|DVD:14.99`).
  - An array of objects (e.g., `[ { "code": "CD", "amount": 11.10 }, { "code": "DVD", "amount": 14.99 } ]`).
- **Basket**: Product-level data for the transaction. The tag can automatically use `items` from the event data. At least the `id`, `name`, `price` and quan`tity must be provided for each product.
- **Customer Acquisition**: A flag to indicate if this is a new customer.
- **Transaction Time**: The timestamp of when the conversion happened.
- **Is Test**: Set to true to send a test transaction.
- **Custom Parameters**: Add any additional custom data to the request.
- **Webhook URL**: Specify a webhook URL for Awin to send notifications to.

## Cookie Consent Settings

This section controls how the tag handles user consent for setting and reading attribution cookies (`awin_awc`, `awin_sn_awc`, `awin_source`).

- **Consent Detection**: You can choose how the tag determines consent:
  - **Automatically**: The tag will check for consent signals from Google Consent Mode or Stape's Data Tag.
  - **Manually**: You can provide a custom variable that specifies the consent status (`true`/`false` or `1`/`0`).
- **Enable Unconditional Cashback & Rewards Tracking**: This is a special setting for **Cashbacks & Rewards Journeys**. When enabled, the tag is allowed to set the necessary attribution cookie (`awin_sn_awc`) and read them (`awin_sn_awc` and `awin_awc`) even if the user has not given consent.

## Useful resources

- [What is Conversion API? (Awin)](https://advertiser-success.awin.com/s/article/What-is-Conversion-API)
- [Conversion API Documentation](https://developer.awin.com/apidocs/conversion-api)
- [Step-by-step guide on how to configure Awin CAPI tag](https://stape.io/helpdesk/documentation/awin-conversion-api-tag)

## Open Source

The **Awin Conversion API Tag for GTM Server-Side** is developed and maintained by the [Stape Team](https://stape.io/) under the Apache 2.0 license.

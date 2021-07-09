var defaultFilteringSettings = {
  blockingLevel: 1,
  contentTypes: [],
  exceptionDomains: []
}

var enabledFilteringOptions = {
  blockingLevel: 0,
  contentTypes: [], // script, image
  exceptionDomains: []
}

// for tracking the number of blocked requests
var unsavedBlockedRequests = 0

const filterProtocols = { urls: ['https://*/*', 'http://*/*'] }

setInterval(function () {
  if (unsavedBlockedRequests > 0) {
    var current = settings.get('filteringBlockedCount')
    if (!current) {
      current = 0
    }
    settings.set('filteringBlockedCount', current + unsavedBlockedRequests)
    unsavedBlockedRequests = 0
  }
}, 60000)

// electron uses different names for resource types than ABP
// electron: https://github.com/electron/electron/blob/34c4c8d5088fa183f56baea28809de6f2a427e02/shell/browser/net/atom_network_delegate.cc#L30
// abp: https://adblockplus.org/filter-cheatsheet#filter-options
var electronABPElementTypeMap = {
  mainFrame: 'document',
  subFrame: 'subdocument',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  object: 'object',
  xhr: 'xmlhttprequest',
  other: 'other' // ?
}

var parser = require('./ext/abp-filter-parser-modified/abp-filter-parser.js')
var parsedFilterData = {}

function initFilterList () {
  // discard old data if the list is being re-initialized
  parsedFilterData = {}

  fs.readFile(__dirname + '/ext/filterLists/easylist+easyprivacy-noelementhiding.txt', 'utf8', function (err, data) {
    if (err) {
      return
    }
    parser.parse(data, parsedFilterData)
  })

  fs.readFile(app.getPath('userData') + '/customFilters.txt', 'utf8', function (err, data) {
    if (!err && data) {
      parser.parse(data, parsedFilterData)
    }
  })
}

function removeWWW (domain) {
  return domain.replace(/^www\./i, '')
}

function isHTTP (url) {
  return (url.startsWith('http://') || url.startsWith('https://'))
}

function requestIsThirdParty (baseDomain, requestURL) {
  baseDomain = removeWWW(baseDomain)
  var requestDomain = removeWWW(parser.getUrlHost(requestURL))

  return !(parser.isSameOriginHost(baseDomain, requestDomain) || parser.isSameOriginHost(requestDomain, baseDomain))
}

function requestDomainIsException (domain) {
  return enabledFilteringOptions.exceptionDomains.includes(removeWWW(domain))
}

function filterPopups (url) {
  if (!isHTTP(url)) {
    return true
  }

  const domain = parser.getUrlHost(url)

  if (enabledFilteringOptions.blockingLevel > 0 && !requestDomainIsException(domain)) {
    if (
      (enabledFilteringOptions.blockingLevel === 1 && requestIsThirdParty(domain, url)) ||
      (enabledFilteringOptions.blockingLevel === 2)
    ) {
      if (parser.matches(parsedFilterData, url, { domain: domain, elementType: 'popup' })) {
        unsavedBlockedRequests++
        return false
      }
    }
  }

  return true
}

// block third party cookies
function filterCookies (details, callback) {
  var headers = { cancel: false }

  if (enabledFilteringOptions.blockingLevel === 0 || !('set-cookie' in details.responseHeaders)) {
    callback(headers)
    return
  }

  const originalDomain = removeWWW(parser.getUrlHost(
    webContents.fromId(details.webContentsId).getURL()
  ))

  if (requestIsThirdParty(originalDomain, details.url)) {
    headers.responseHeaders = details.responseHeaders
    delete headers.responseHeaders['set-cookie']
  }
  callback(headers)
}

function handleRequest (details, callback) {
  if (details.resourceType === 'mainFrame') {
    callback({
      cancel: false,
      requestHeaders: details.requestHeaders
    })
    return
  }

  // block javascript and images if needed
  if (enabledFilteringOptions.contentTypes.length > 0) {
    for (var i = 0; i < enabledFilteringOptions.contentTypes.length; i++) {
      if (details.resourceType === enabledFilteringOptions.contentTypes[i]) {
        callback({
          cancel: true,
          requestHeaders: details.requestHeaders
        })
        return
      }
    }
  }

  if (details.webContentsId) {
    var domain = parser.getUrlHost(webContents.fromId(details.webContentsId).getURL())
  } else {
    // webContentsId may not exist if this request is for the main document of a subframe
    var domain = undefined
  }

  if (enabledFilteringOptions.blockingLevel > 0 && !(domain && requestDomainIsException(domain))) {
    if (
      (enabledFilteringOptions.blockingLevel === 1 && (!domain || requestIsThirdParty(domain, details.url))) ||
      (enabledFilteringOptions.blockingLevel === 2)
    ) {
      // by doing this check second, we can skip checking same-origin requests if only third-party blocking is enabled
      var matchesFilters = parser.matches(parsedFilterData, details.url, {
        domain: domain,
        elementType: electronABPElementTypeMap[details.resourceType]
      })
      if (matchesFilters) {
        unsavedBlockedRequests++

        callback({
          cancel: true,
          requestHeaders: details.requestHeaders
        })
        return
      }
    }
  }

  callback({
    cancel: false,
    requestHeaders: details.requestHeaders
  })
}

function setFilteringSettings (settings) {
  if (!settings) {
    settings = {}
  }

  for (var key in defaultFilteringSettings) {
    if (settings[key] === undefined) {
      settings[key] = defaultFilteringSettings[key]
    }
  }

  if (settings.blockingLevel > 0 && !(enabledFilteringOptions.blockingLevel > 0)) { // we're enabling tracker filtering
    initFilterList()
  }

  enabledFilteringOptions.contentTypes = settings.contentTypes
  enabledFilteringOptions.blockingLevel = settings.blockingLevel
  enabledFilteringOptions.exceptionDomains = settings.exceptionDomains.map(d => removeWWW(d))
}

function registerFiltering (ses) {
  // check responses in search of third-party cookies
  ses.webRequest.onResponseStarted(filterProtocols,
    (d) => {
      if (d.webContentsId) {
        const s = webContents.fromId(d.webContentsId).session
        s.webRequest.onHeadersReceived(filterCookies)
      }
    })

  ses.webRequest.onBeforeRequest(filterProtocols, handleRequest)
}

app.once('ready', function () {
  registerFiltering(session.defaultSession)
})

app.on('session-created', registerFiltering)

settings.listen('filtering', function (value) {
  // migrate from old settings (<v1.9.0)
  if (value && typeof value.trackers === 'boolean') {
    if (value.trackers === true) {
      value.blockingLevel = 2
    } else if (value.trackers === false) {
      value.blockingLevel = 0
    }
    delete value.trackers
    settings.set('filtering', value)
  }

  setFilteringSettings(value)
})

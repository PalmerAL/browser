/* global db performance searchPlaces fullTextPlacesSearch */

const { ipcRenderer } = require('electron')

const spacesRegex = /[+\s._/-]+/g // things that could be considered spaces

function calculateHistoryScore (item) { // item.boost - how much the score should be multiplied by. Example - 0.05
  let fs = item.lastVisit * (1 + 0.036 * Math.sqrt(item.visitCount))

  // bonus for short url's
  if (item.url.length < 20) {
    fs += (30 - item.url.length) * 2500
  }

  if (item.boost) {
    fs += fs * item.boost
  }

  return fs
}

const oneDayInMS = 24 * 60 * 60 * 1000 // one day in milliseconds

// the oldest an item can be to remain in the database
const maxItemAge = oneDayInMS * 42

function cleanupHistoryDatabase () { // removes old history entries
  db.places.where('lastVisit').below(Date.now() - maxItemAge).and(function (item) {
    return item.isBookmarked === false
  }).delete()
}

setTimeout(cleanupHistoryDatabase, 20000) // don't run immediately on startup, since is might slow down searchbar search.
setInterval(cleanupHistoryDatabase, 60 * 60 * 1000)

// cache history in memory for faster searching. This actually takes up very little space, so we can cache everything.

let historyInMemoryCache = []
let doneLoadingHistoryCache = false

function addToHistoryCache (item) {
  if (item.isBookmarked) {
    tagIndex.addPage(item)
  }
  delete item.pageHTML
  delete item.searchIndex

  item.searchTextCache = getSearchTextCache(item)

  historyInMemoryCache.push(item)
}

function addOrUpdateHistoryCache (item) {
  delete item.pageHTML
  delete item.searchIndex

  item.searchTextCache = getSearchTextCache(item)

  let oldItem

  for (let i = 0; i < historyInMemoryCache.length; i++) {
    if (historyInMemoryCache[i].url === item.url) {
      oldItem = historyInMemoryCache[i]
      historyInMemoryCache[i] = item
      break
    }
  }

  if (!oldItem) {
    historyInMemoryCache.push(item)
  }

  if (oldItem) {
    tagIndex.onChange(oldItem, item)
  }
}

function removeFromHistoryCache (url) {
  for (let i = 0; i < historyInMemoryCache.length; i++) {
    if (historyInMemoryCache[i].url === url) {
      tagIndex.removePage(historyInMemoryCache[i])
      historyInMemoryCache.splice(i, 1)
    }
  }
}

function loadHistoryInMemory () {
  historyInMemoryCache = []

  db.places.orderBy('visitCount').reverse().each(function (item) {
    addToHistoryCache(item)
  }).then(function () {
    // if we have enough matches during the search, we exit. In order for this to work, frequently visited sites have to come first in the cache.
    historyInMemoryCache.sort(function (a, b) {
      return calculateHistoryScore(b) - calculateHistoryScore(a)
    })

    doneLoadingHistoryCache = true
  })
}

loadHistoryInMemory()

function handleRequest (data, cb) {
  const action = data.action
  const pageData = data.pageData
  const flags = data.flags || {}
  const searchText = data.text && data.text.toLowerCase()
  const callbackId = data.callbackId
  const options = data.options

  if (action === 'getPlace') {
    let found = false
    for (let i = 0; i < historyInMemoryCache.length; i++) {
      if (historyInMemoryCache[i].url === pageData.url) {
        cb({
          result: historyInMemoryCache[i],
          callbackId: callbackId
        })
        found = true
        break
      }
    }
    if (!found) {
      cb({
        result: null,
        callbackId: callbackId
      })
    }
  }

  if (action === 'getAllPlaces') {
    cb({
      result: historyInMemoryCache,
      callbackId: callbackId
    })
  }

  if (action === 'updatePlace') {
    console.time()
    llmAdapter.summarizePage(pageData.extractedText).then(res => {console.timeEnd(); console.log("got summary", res)})
    db.transaction('rw', db.places, function () {
      db.places.where('url').equals(pageData.url).first(function (item) {
        var isNewItem = false
        if (!item) {
          isNewItem = true
          item = {
            url: pageData.url,
            title: pageData.url,
            color: null,
            visitCount: 0,
            lastVisit: Date.now(),
            pageHTML: '',
            extractedText: pageData.extractedText,
            searchIndex: [],
            isBookmarked: false,
            tags: [],
            metadata: {}
          }
        }
        for (const key in pageData) {
          if (key === 'extractedText') {
            item.searchIndex = tokenize(pageData.extractedText)
            item.extractedText = pageData.extractedText
          } else if (key === 'tags') {
          // ensure tags are never saved with spaces in them
            item.tags = pageData.tags.map(t => t.replace(/\s/g, '-'))
          } else {
            item[key] = pageData[key]
          }
        }

        if (flags.isNewVisit) {
          item.visitCount++
          item.lastVisit = Date.now()
        }

        db.places.put(item)
        if (isNewItem) {
          addToHistoryCache(item)
        } else {
          addOrUpdateHistoryCache(item)
        }
        cb({
          result: null,
          callbackId: callbackId
        })
      }).catch(function (err) {
        console.warn('failed to update history.')
        console.warn('page url was: ' + pageData.url)
        console.error(err)
      })
    })
  }

  if (action === 'deleteHistory') {
    db.places.where('url').equals(pageData.url).delete()

    removeFromHistoryCache(pageData.url)
  }

  if (action === 'deleteAllHistory') {
    db.places.filter(function (item) {
      return item.isBookmarked === false
    }).delete().then(function () {
      loadHistoryInMemory()
    })
  }

  if (action === 'getSuggestedTags') {
    cb({
      result: tagIndex.getSuggestedTags(historyInMemoryCache.find(i => i.url === pageData.url)),
      callbackId: callbackId
    })
  }

  if (action === 'getAllTagsRanked') {
    cb({
      result: tagIndex.getAllTagsRanked(historyInMemoryCache.find(i => i.url === pageData.url)),
      callbackId: callbackId
    })
  }

  if (action === 'getSuggestedItemsForTags') {
    cb({
      result: tagIndex.getSuggestedItemsForTags(pageData.tags),
      callbackId: callbackId
    })
  }

  if (action === 'autocompleteTags') {
    cb({
      result: tagIndex.autocompleteTags(pageData.tags),
      callbackId: callbackId
    })
  }

  if (action === 'searchPlaces') { // do a history search
    searchPlaces(searchText, function (matches) {
      cb({
        result: matches,
        callbackId: callbackId
      })
    }, options)
  }

  if (action === 'searchPlacesFullText') {
    fullTextPlacesSearch(searchText, function (matches) {
      matches.sort(function (a, b) {
        return calculateHistoryScore(b) - calculateHistoryScore(a)
      })

      cb({
        result: matches.slice(0, 100),
        callbackId: callbackId
      })
    })
  }

  if (action === 'getPlaceSuggestions') {
    function returnSuggestionResults () {
      const cTime = Date.now()

      let results = historyInMemoryCache.slice().filter(i => cTime - i.lastVisit < 604800000)

      for (let i = 0; i < results.length; i++) {
        results[i].hScore = calculateHistoryScore(results[i])
      }

      results = results.sort(function (a, b) {
        return b.hScore - a.hScore
      })

      cb({
        result: results.slice(0, 100),
        callbackId: callbackId
      })
    }
    if (historyInMemoryCache.length > 10 || doneLoadingHistoryCache) {
      returnSuggestionResults()
    } else {
      setTimeout(returnSuggestionResults, 100)
    }
  }
}

ipcRenderer.on('places-connect', function (e) {
  e.ports[0].addEventListener('message', function (e2) {
    const data = e2.data

    handleRequest(data, function (res) {
      e.ports[0].postMessage(res)
    })
  })
  e.ports[0].start()
})

// Initialize LLM service

const llmAdapter = {
  messagePort: null,
  pendingPromises: {},
  invokeWithPromise: function (data) {
    const callbackId = Math.random()
    const { promise, resolve, reject } = Promise.withResolvers()
    llmAdapter.pendingPromises[callbackId] = { promise, resolve, reject }
    llmAdapter.messagePort.postMessage({
      ...data,
      callbackId
    })
    return promise
  },
  replyToPromise: function (callbackId, result) {
    if (llmAdapter.pendingPromises[callbackId]) {
      llmAdapter.pendingPromises[callbackId].resolve(result)
      delete llmAdapter.pendingPromises[callbackId]
    } else {
      throw new Error('missing callbackId')
    }
  },
  summarizePage: function (text) {
    const textToSummarize = text.substring(0, 20000)
    console.log("getting summary", textToSummarize)
    return llmAdapter.invokeWithPromise({
      action: 'run',
      // TODO there's some character encoding problem when passing text to the subprocess; encodeURIComponent seems to help
      input: encodeURIComponent(`Write one short sentence summarizing the key point of the text. Be concise. Do not mention the author. Use the following template for your response: [The key point is that]: [your answer]. \n` + textToSummarize)
    })
  },
  onMessage: function (e) {
    if (e.data.callbackId) {
      llmAdapter.replyToPromise(e.data.callbackId, e.data.result)
    }
  },
  initialize: () => {
    const { port1, port2 } = new MessageChannel()

    ipcRenderer.postMessage('llm-service-connect', null, [port1])

    llmAdapter.messagePort = port2
    port2.addEventListener('message', llmAdapter.onMessage)

    port2.start()
  }
}

llmAdapter.initialize()

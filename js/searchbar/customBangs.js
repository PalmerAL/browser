/* list of the available custom !bangs */

const { ipcRenderer } = require('electron')
const fs = require('fs')

const bangsPlugin = require('searchbar/bangsPlugin.js')

const webviews = require('webviews.js')
const browserUI = require('browserUI.js')
const focusMode = require('focusMode.js')
const places = require('places/places.js')
const contentBlockingToggle = require('navbar/contentBlockingToggle.js')
const taskOverlay = require('taskOverlay/taskOverlay.js')
const bookmarkConverter = require('bookmarkConverter.js')
const searchbarPlugins = require('searchbar/searchbarPlugins.js')
const tabEditor = require('navbar/tabEditor.js')
const formatRelativeDate = require('util/relativeDate.js')

function moveToTask (text) {
  /* disabled in focus mode */
  if (focusMode.enabled()) {
    focusMode.warn()
    return
  }

  // remove the tab from the current task

  const currentTab = tabs.get(tabs.getSelected())
  tabs.destroy(currentTab.id)

  // make sure the task has at least one tab in it
  if (tabs.count() === 0) {
    tabs.add()
  }

  let newTask = getTaskByNameOrNumber(text.toLowerCase())

  if (newTask) {
    newTask.tabs.add(currentTab, { atEnd: true })
  } else {
    // create a new task with the given name
    newTask = tasks.get(tasks.add(undefined, tasks.getIndex(tasks.getSelected().id) + 1))
    newTask.name = text

    newTask.tabs.add(currentTab)
  }

  browserUI.switchToTask(newTask.id)
  browserUI.switchToTab(currentTab.id)

  taskOverlay.show()

  setTimeout(function () {
    taskOverlay.hide()
  }, 600)
}

function switchToTask (text) {
  /* disabled in focus mode */
  if (focusMode.enabled()) {
    focusMode.warn()
    return
  }

  text = text.toLowerCase()

  // no task was specified, show all of the tasks
  if (!text) {
    taskOverlay.show()
    return
  }

  const task = getTaskByNameOrNumber(text)

  if (task) {
    browserUI.switchToTask(task.id)
  }
}

// returns a task with the same name or index ("1" returns the first task, etc.)
// In future PR move this to task.js
function getTaskByNameOrNumber (text) {
  const textAsNumber = parseInt(text)

  return tasks.find((task, index) => (task.name && task.name.toLowerCase() === text) || index + 1 === textAsNumber
  )
}

// return an array of dicts, sorted by last task activity
// if a search string is present (and not a number) filter the results with a basic fuzzy search
function searchAndSortTasks (text) {
  let sortLastActivity = tasks.map(t => Object.assign({}, { task: t }, { lastActivity: tasks.getLastActivity(t.id) }))

  sortLastActivity = sortLastActivity.sort(function (a, b) {
    return b.lastActivity - a.lastActivity
  })

  const isSingleNumber = /^\d+$/.test(text)

  if (text !== '' ? !isSingleNumber : !isSingleNumber) { // lXOR
    // fuzzy search
    let matches = []
    const searchText = text.toLowerCase()

    sortLastActivity.forEach(function (t) {
      const task = t.task
      const taskName = (task.name ? task.name : l('defaultTaskName').replace('%n', tasks.getIndex(task.id) + 1)).toLowerCase()
      const exactMatch = taskName.indexOf(searchText) !== -1
      const fuzzyTitleScore = taskName.score(searchText, 0.5)

      if (exactMatch || fuzzyTitleScore > 0.4) {
        matches.push({
          task: t,
          score: fuzzyTitleScore + exactMatch
        })
      }
    })

    matches = matches.sort(function (a, b) {
      return b.score - a.score
    })

    sortLastActivity = matches.map(t => t.task)
  }

  return sortLastActivity
}

function initialize () {
  bangsPlugin.registerCustomBang({
    phrase: '!settings',
    snippet: l('viewSettings'),
    isAction: true,
    fn: function (text) {
      webviews.update(tabs.getSelected(), 'min://settings')
    }
  })

  bangsPlugin.registerCustomBang({
    phrase: '!back',
    snippet: l('goBack'),
    isAction: true,
    fn: function (text) {
      webviews.callAsync(tabs.getSelected(), 'goBack')
    }
  })

  bangsPlugin.registerCustomBang({
    phrase: '!forward',
    snippet: l('goForward'),
    isAction: true,
    fn: function (text) {
      webviews.callAsync(tabs.getSelected(), 'goForward')
    }
  })

  bangsPlugin.registerCustomBang({
    phrase: '!screenshot',
    snippet: l('takeScreenshot'),
    isAction: true,
    fn: function (text) {
      setTimeout(function () { // wait so that the view placeholder is hidden
        ipcRenderer.send('saveViewCapture', { id: tabs.getSelected() })
      }, 400)
    }
  })

  bangsPlugin.registerCustomBang({
    phrase: '!clearhistory',
    snippet: l('clearHistory'),
    isAction: true,
    fn: function (text) {
      if (confirm(l('clearHistoryConfirmation'))) {
        places.deleteAllHistory()
        ipc.invoke('clearStorageData')
      }
    }
  })

  bangsPlugin.registerCustomBang({
    phrase: '!enableblocking',
    snippet: l('enableBlocking'),
    isAction: true,
    fn: function (text) {
      contentBlockingToggle.enableBlocking(tabs.get(tabs.getSelected()).url)
    }
  })

  bangsPlugin.registerCustomBang({
    phrase: '!disableblocking',
    snippet: l('disableBlocking'),
    isAction: true,
    fn: function (text) {
      contentBlockingToggle.disableBlocking(tabs.get(tabs.getSelected()).url)
    }
  })

  bangsPlugin.registerCustomBang({
    phrase: '!movetotask',
    snippet: l('moveToTask'),
    isAction: false,
    showSuggestions: function (text, input, event) {
      searchbarPlugins.reset('bangs')

      const sortLastActivity = searchAndSortTasks(text)

      sortLastActivity.forEach(function (t) {
        const task = t.task
        const lastActivity = t.lastActivity

        if (task.id != tasks.getSelected().id) {
          const taskName = (task.name ? task.name : l('defaultTaskName').replace('%n', tasks.getIndex(task.id) + 1))

          const data = {
            title: taskName,
            secondaryText: formatRelativeDate(lastActivity),
            fakeFocus: false,
            click: function () {
              tabEditor.hide()
              moveToTask('%n'.replace('%n', tasks.getIndex(task.id) + 1))
            }
          }

          searchbarPlugins.addResult('bangs', data)
        }
      })
    },

    fn: moveToTask

  })

  bangsPlugin.registerCustomBang({
    phrase: '!task',
    snippet: l('switchToTask'),
    isAction: false,
    showSuggestions: function (text, input, event) {
      searchbarPlugins.reset('bangs')

      const sortLastActivity = searchAndSortTasks(text)

      sortLastActivity.forEach(function (t) {
        const task = t.task
        const lastActivity = t.lastActivity

        if (task.id != tasks.getSelected().id) {
          const taskName = (task.name ? task.name : l('defaultTaskName').replace('%n', tasks.getIndex(task.id) + 1))

          const data = {
            title: taskName,
            secondaryText: formatRelativeDate(lastActivity),
            fakeFocus: false,
            click: function () {
              tabEditor.hide()
              switchToTask('%n'.replace('%n', tasks.getIndex(task.id) + 1))
            }
          }

          searchbarPlugins.addResult('bangs', data)
        }
      })
    },

    fn: switchToTask

  })
  bangsPlugin.registerCustomBang({
    phrase: '!newtask',
    snippet: l('createTask'),
    isAction: true,
    fn: function (text) {
      /* disabled in focus mode */
      if (focusMode.enabled()) {
        focusMode.warn()
        return
      }

      taskOverlay.show()

      setTimeout(function () {
        browserUI.addTask()
        if (text) {
          tasks.getSelected().name = text
        }
      }, 600)
    }
  })

  bangsPlugin.registerCustomBang({
    phrase: '!closetask',
    snippet: l('closeTask'),
    isAction: false,
    fn: function (text) {
      const currentTask = tasks.getSelected()
      let taskToClose

      if (text) {
        taskToClose = getTaskByNameOrNumber(text)
      } else {
        taskToClose = tasks.getSelected()
      }

      if (taskToClose) {
        browserUI.closeTask(taskToClose.id)
        if (currentTask.id === taskToClose.id) {
          taskOverlay.show()
          setTimeout(function () {
            taskOverlay.hide()
          }, 600)
        }
      }
    }
  })

  bangsPlugin.registerCustomBang({
    phrase: '!nametask',
    snippet: l('nameTask'),
    isAction: false,
    fn: function (text) {
      tasks.getSelected().name = text
    }
  })

  bangsPlugin.registerCustomBang({
    phrase: '!importbookmarks',
    snippet: l('importBookmarks'),
    isAction: true,
    fn: async function () {
      const filePath = await ipc.invoke('showOpenDialog', {
        filters: [
          { name: 'HTML files', extensions: ['htm', 'html'] }
        ]
      })

      if (!filePath) {
        return
      }
      fs.readFile(filePath[0], 'utf-8', function (err, data) {
        if (err || !data) {
          console.warn(err)
          return
        }
        bookmarkConverter.import(data)
      })
    }
  })

  bangsPlugin.registerCustomBang({
    phrase: '!exportbookmarks',
    snippet: l('exportBookmarks'),
    isAction: true,
    fn: async function () {
      const data = await bookmarkConverter.exportAll()
      // save the result
      const savePath = await ipc.invoke('showSaveDialog', { defaultPath: 'bookmarks.html' })
      require('fs').writeFileSync(savePath, data)
    }
  })

  bangsPlugin.registerCustomBang({
    phrase: '!addbookmark',
    snippet: l('addBookmark'),
    fn: function (text) {
      const url = tabs.get(tabs.getSelected()).url
      if (url) {
        places.updateItem(url, {
          isBookmarked: true,
          tags: (text ? text.split(/\s/g).map(t => t.replace('#', '').trim()) : [])
        }, () => { })
      }
    }
  })
}

module.exports = { initialize }

/* fades out tabs that are inactive */

var tabBar = require('navbar/tabBar.js')

var tabActivity = {
  minFadeAge: 330000,
  refreshInterval: 7500,
  tabSelected: function() {
      var selected = tabs.getSelected()
      if (tabBar.getTab(selected).classList.contains('fade')) {
        // check to see if it is still has been selected in .500 seconds
        setTimeout(function (tabID) {
          if (tabs.getSelected() != tabID) {
            var tab = tabs.get(tabID)
            if (tab) {
              tabBar.getTab(tabID).classList.add('fade') 
              tabs.update(tabID, {'lastActivity':tab.lastActivity - tabActivity.minFadeAge})
            }
            
          } 
        }, 500, selected);
      }

      // never fade the current tab
      tabBar.getTab(selected).classList.remove('fade')

    
  },
  refresh: function () {
    requestAnimationFrame(function () {
      var tabSet = tabs.get()
      var selected = tabs.getSelected()
      var time = Date.now()

      tabSet.forEach(function (tab) {
        if (selected == tab.id) { return }

        //else
        if ((time - tab.lastActivity > tabActivity.minFadeAge)) { // the tab has been inactive for greater than minActivity, and it is not currently selected
          tabBar.getTab(tab.id).classList.add('fade')
        } else {
          tabBar.getTab(tab.id).classList.remove('fade')
        }
      })
    })
  },
  initialize: function () {
    setInterval(tabActivity.refresh, this.refreshInterval)

    tasks.on('tab-selected', this.tabSelected)
  }
}

module.exports = tabActivity

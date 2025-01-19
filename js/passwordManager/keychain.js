const { ipcRenderer } = require('electron')
const papaparse = require('papaparse')

class Keychain {
  constructor () {
    this.name = 'Built-in password manager'
  }

  getDownloadLink () {
    return null
  }

  getLocalPath () {
    return null
  }

  getSetupMode () {
    return null
  }

  async checkIfConfigured () {
    return true
  }

  isUnlocked () {
    return true
  }

  async getSuggestions (domain) {
    return ipcRenderer.invoke('credentialStoreGetCredentials').then(function (results) {
      return results
        .filter(function (result) {
          return result.domain === domain
        })
        .map(function (result) {
          return {
            ...result,
            manager: 'Keychain'
          }
        })
    })
  }

  saveCredential (domain, username, password) {
    ipcRenderer.invoke('credentialStoreSetPassword', { domain, username, password })
  }

  deleteCredential (domain, username) {
    ipcRenderer.invoke('credentialStoreDeletePassword', { domain, username })
  }

  async importCredentials (fileContents) {
    try {
      const csvData = papaparse.parse(fileContents, {
        header: true,
        skipEmptyLines: true,
        transformHeader (header) {
          return header.toLowerCase().trim().replace(/["']/g, '')
        }
      })
      const credentialsToImport = csvData.data.map((credential) => {
        try {
          const includesProtocol = credential.url.match(/^https?:\/\//g)
          const domainWithProtocol = includesProtocol ? credential.url : `https://${credential.url}`

          return {
            domain: new URL(domainWithProtocol).hostname.replace(/^www\./g, ''),
            username: credential.username,
            password: credential.password
          }
        } catch {
          return null
        }
      }).filter(credential => credential !== null)

      if (credentialsToImport.length === 0) return []

      const currentCredentials = await this.getAllCredentials()
      const credentialsWithoutDuplicates = currentCredentials.filter(account => !credentialsToImport.some(a => a.domain === account.domain && a.username === account.username))

      const mergedCredentials = credentialsWithoutDuplicates.concat(credentialsToImport)

      await ipcRenderer.invoke('credentialStoreSetPasswordBulk', mergedCredentials)
      return mergedCredentials
    } catch (error) {
      console.error('Error importing credentials:', error)
      return []
    }
  }

  getAllCredentials () {
    return ipcRenderer.invoke('credentialStoreGetCredentials').then(function (results) {
      return results.map(function (result) {
        return {
          ...result,
          manager: 'Keychain'
        }
      })
    })
  }
}

module.exports = Keychain

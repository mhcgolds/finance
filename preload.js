const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onMenuAction:       (cb)        => ipcRenderer.on('menu-action', (_, action) => cb(action)),
  getEntryMonths:     ()          => ipcRenderer.invoke('get-entry-months'),
  getMonthlySummary:  ()          => ipcRenderer.invoke('get-monthly-summary'),
  getCategoriesFull:  ()       => ipcRenderer.invoke('get-categories-full'),
  updateCategory:     (cat)    => ipcRenderer.invoke('update-category', cat),
  deleteCategory:     (id)     => ipcRenderer.invoke('delete-category', id),
  getEntries:         (filters)=> ipcRenderer.invoke('get-entries', filters),
  importCsv:          ()       => ipcRenderer.invoke('import-csv'),
  saveEntries:        (rows)   => ipcRenderer.invoke('save-entries', rows),
  saveCategories:     (updates)=> ipcRenderer.invoke('save-categories', updates),
});

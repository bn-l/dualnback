const root = document.querySelector<HTMLDivElement>('#root')
if (root === null) {
    throw new Error('index.html is missing #root')
}
root.textContent = 'Dual N-Back'

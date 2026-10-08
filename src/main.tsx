import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DAppKitProvider } from '@mysten/dapp-kit-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import './index.css'
import { dAppKit } from './dapp-kit'
import App from './App'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DAppKitProvider dAppKit={dAppKit}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </DAppKitProvider>
    </QueryClientProvider>
  </StrictMode>,
)

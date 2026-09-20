import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { BasdrawPluginProvider } from './plugins/PluginContext'
import { AccessPolicyProvider } from './access/AccessPolicyContext'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
	<React.StrictMode>
		<AccessPolicyProvider>
			<BasdrawPluginProvider>
				<App />
			</BasdrawPluginProvider>
		</AccessPolicyProvider>
	</React.StrictMode>
)

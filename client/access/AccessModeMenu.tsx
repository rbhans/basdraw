import {
	TldrawUiButton,
	TldrawUiButtonIcon,
	TldrawUiButtonLabel,
	TldrawUiDropdownMenuContent,
	TldrawUiDropdownMenuRoot,
	TldrawUiDropdownMenuTrigger,
	TldrawUiMenuContextProvider,
	TldrawUiMenuItem,
} from 'tldraw'
import { BASDRAW_ACCESS_PROFILES } from '../../shared/access'
import { useAccessPolicy } from './AccessPolicyContext'

export function AccessModeMenu() {
	const { profileId, setProfileId } = useAccessPolicy()
	const current = BASDRAW_ACCESS_PROFILES.find((profile) => profile.id === profileId)!
	return <TldrawUiDropdownMenuRoot id="basdraw-access-mode">
		<TldrawUiDropdownMenuTrigger>
			<TldrawUiButton type="normal" aria-label={`Access mode: ${current.label}`} title={current.description}>
				<TldrawUiButtonIcon icon={profileId === 'view-only' ? 'lock' : 'unlock'} small />
				<TldrawUiButtonLabel>{current.label}</TldrawUiButtonLabel>
			</TldrawUiButton>
		</TldrawUiDropdownMenuTrigger>
		<TldrawUiDropdownMenuContent side="bottom" align="end" alignOffset={0}>
			<TldrawUiMenuContextProvider type="menu" sourceId="menu">
				{BASDRAW_ACCESS_PROFILES.map((profile) => <TldrawUiMenuItem
					key={profile.id}
					id={`basdraw-access-${profile.id}`}
					readonlyOk
					label={`${profile.id === profileId ? '✓ ' : ''}${profile.label}`}
					onSelect={() => setProfileId(profile.id)}
				/>) }
			</TldrawUiMenuContextProvider>
		</TldrawUiDropdownMenuContent>
	</TldrawUiDropdownMenuRoot>
}

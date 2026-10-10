/** Pairing responses at the external HTTP boundary of SSH launcher fixtures. */
export function relayPairingResponse(url: string, deviceId: string): Response | null {
  if (url.endsWith('/pairing/links'))
    return Response.json({ code: 'ABCDEFGHJKLM', expiresAt: new Date().toISOString(), url: null })
  if (url.endsWith('/pairing/claim'))
    return Response.json(
      { deviceId },
      { headers: { 'set-cookie': 'relay_device=fixture.secret; HttpOnly' } },
    )
  return null
}

export type IgdbErrorCode = 'HTTP_ERROR' | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'TIMEOUT' | 'ABORTED'

export type IgdbErrorPhase = 'auth' | 'request'

/** An upstream failure without response bodies, credentials or unsafe causes. */
export class IgdbError extends Error {
    override readonly name = 'IgdbError'
    readonly code: IgdbErrorCode
    readonly phase: IgdbErrorPhase
    readonly status: number | undefined
    /** Retry-After expressed in seconds, including when the server sent an HTTP date. */
    readonly retryAfter: number | undefined

    constructor(code: IgdbErrorCode, phase: IgdbErrorPhase, details: { status?: number; retryAfter?: number } = {}) {
        const subject = phase === 'auth' ? 'Twitch authentication' : 'IGDB request'
        const messages: Record<IgdbErrorCode, string> = {
            HTTP_ERROR: `${subject} failed with HTTP ${details.status ?? 'error'}.`,
            NETWORK_ERROR: `${subject} could not complete the network request.`,
            INVALID_RESPONSE: `${subject} returned an invalid response.`,
            TIMEOUT: `${subject} timed out.`,
            ABORTED: `${subject} was aborted.`,
        }
        super(messages[code])
        this.code = code
        this.phase = phase
        this.status = details.status
        this.retryAfter = details.retryAfter
    }
}

/**
 * Wire shapes mirroring the backend's public contracts. Kept here so
 * UI code never imports from `@/lib/api-client` for types — that file
 * stays concerned with transport only.
 */

export interface PublicUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

export interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

export interface SignupResponse {
  readonly user: PublicUser;
}

export type LoginResponse =
  | {
      readonly mfa_required: false;
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly user: PublicUser;
      readonly organizations: ReadonlyArray<OrganizationSummary>;
    }
  | {
      readonly mfa_required: true;
      readonly mfaChallengeToken: string;
    };

export interface MfaVerifyChallengeResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly user: PublicUser;
}

export interface SelectOrganizationResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly role: string;
  };
}

export interface RefreshResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface AcceptInvitationResponse {
  readonly user: { readonly id: string; readonly email: string };
  readonly organization: { readonly id: string; readonly name: string; readonly slug: string };
  readonly membership: { readonly id: string; readonly role: string };
  readonly userCreated: boolean;
}

export interface MfaSetupResponse {
  readonly secret: string;
  readonly otpauthUri: string;
}

export interface MfaActivationResponse {
  readonly backupCodes: ReadonlyArray<string>;
}

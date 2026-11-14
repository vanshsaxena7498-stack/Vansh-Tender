export const VALID_LOGIN_USERNAME = 'VanshSales';
export const VALID_LOGIN_PASSWORD = 'Vansh@2027';

export interface LoginValidationResult {
  ok: boolean;
  error?: string;
}

export function validateLoginCredentials(
  usernameInput: string,
  passwordInput: string,
): LoginValidationResult {
  const trimmedUser = usernameInput.trim();
  if (!trimmedUser) {
    return { ok: false, error: 'Please enter your Username or Email ID.' };
  }
  if (!passwordInput) {
    return { ok: false, error: 'Please enter your Password.' };
  }
  if (trimmedUser !== VALID_LOGIN_USERNAME || passwordInput !== VALID_LOGIN_PASSWORD) {
    return {
      ok: false,
      error: 'Invalid username or password. Please check your credentials and try again.',
    };
  }
  return { ok: true };
}

export const PASSWORD_MIN_LENGTH = 10;

export function passwordTieneLongitudInvalida(password) {
  return typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH;
}

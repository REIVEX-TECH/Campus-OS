/**
 * Conventional Commits enforcement.
 * Scope should be the module or package name, e.g. feat(timetable): ...
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0, 'always'],
  },
};

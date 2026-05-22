# Linting

Linting a project looks like this:

```ts
// ::SPOOL:: <<src/commands/lint/lint-project.ts#lintProject>>
```

The code for the command is defined here. To lint the project...

```ts
// ::SPOOL:: <<src/commands/lint/command.ts#lintCommand>>
```

Now we can define a `lint` command in the CLI:

```ts
// ::SPOOL:: <<src/cli.ts#lint>>
```

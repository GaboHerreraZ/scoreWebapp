<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Base de datos — Prisma Migrations

### Comandos disponibles

| Comando | Descripción |
|---|---|
| `npm run prisma:generate` | Regenera el cliente Prisma después de cambios en el schema |
| `npm run prisma:migrate:dev` | Crea y aplica una migración en desarrollo |
| `npm run prisma:migrate:create` | Crea el archivo de migración SIN aplicarla (para revisarla antes) |
| `npm run prisma:migrate:deploy` | Aplica migraciones pendientes en producción |
| `npm run prisma:migrate:status` | Muestra el estado de las migraciones |
| `npm run prisma:studio` | Abre Prisma Studio para ver la BBDD en el navegador |

### Agregar columnas sin afectar data existente (paso a paso)

Cuando necesites agregar nuevas columnas a una tabla que ya tiene datos:

**1. Modifica el schema** (`prisma/schema.prisma`)

Agrega el nuevo campo. Si la tabla ya tiene filas, el campo debe ser **opcional (`?`)** o tener un **valor por defecto (`@default`)**, de lo contrario la migración fallará porque las filas existentes no tendrían valor.

```prisma
// Correcto — campo opcional
newField String? @map("new_field")

// Correcto — campo con valor por defecto
newField String @default("pending") @map("new_field")

// Incorrecto — fallará si ya hay data
newField String @map("new_field")
```

**2. Crea la migración (sin aplicarla)**

```bash
npm run prisma:migrate:create -- --name descripcion_del_cambio
```

Esto genera un archivo SQL en `prisma/migrations/` que puedes revisar antes de aplicar.

**3. Revisa el SQL generado**

Abre el archivo en `prisma/migrations/<timestamp>_descripcion_del_cambio/migration.sql` y verifica que:
- Solo haga `ALTER TABLE ... ADD COLUMN`
- No haga `DROP` de nada
- No haga `TRUNCATE` ni modifique datos existentes

**4. Aplica la migración**

```bash
# En desarrollo
npm run prisma:migrate:dev

# En producción
npm run prisma:migrate:deploy
```

**5. Regenera el cliente**

```bash
npm run prisma:generate
```

### Resumen rápido (comando único en desarrollo)

Si confías en el cambio y quieres hacerlo todo en un paso:

```bash
npm run prisma:migrate:dev -- --name descripcion_del_cambio
```

Esto crea la migración, la aplica y regenera el cliente automáticamente.

---

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

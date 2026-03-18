#!/usr/bin/env node

import { createProgram } from "./cli.js";

void createProgram().parseAsync(process.argv);

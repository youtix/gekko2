import path from 'node:path';

export default {
  test: {
    mockReset: true,
    coverage: {
      reporter: ['text'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{schema,mock,types,error,const}.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 90,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@constants': path.resolve(__dirname, './src/constants'),
      '@models': path.resolve(__dirname, './src/models'),
      '@errors': path.resolve(__dirname, './src/errors'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@services': path.resolve(__dirname, './src/services'),
      '@indicators': path.resolve(__dirname, './src/indicators'),
      '@strategies': path.resolve(__dirname, './src/strategies'),
      '@plugins': path.resolve(__dirname, './src/plugins'),
    },
  },
};

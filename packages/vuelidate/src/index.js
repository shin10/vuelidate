import { watch, computed, getCurrentInstance, inject, onBeforeMount, onBeforeUnmount, provide, isRef, ref } from 'vue-demi'
import { isFunction, unwrap } from './utils'
import { setValidations } from './core'

const VuelidateInjectChildResults = Symbol('vuelidate#injectChiildResults')
const VuelidateRemoveChildResults = Symbol('vuelidate#removeChiildResults')

export const CollectFlag = {
  COLLECT_ALL: 1,
  COLLECT_NONE: 0
}

/**
 * Create helpers to collect validation state from child components
 * @param {Object} params
 * @param {String | Number} params.$scope - Parent component scope
 * @return {{sendValidationResultsToParent: function, childResults: ComputedRef<Object>, removeValidationResultsFromParent: function}}
 */
function nestedValidations ({ $scope = CollectFlag.COLLECT_ALL }) {
  const childResultsRaw = {}
  const childResultsKeys = ref([])
  const childResults = computed(() => childResultsKeys.value.reduce((results, key) => {
    results[key] = unwrap(childResultsRaw[key])
    return results
  }, {}))

  /**
   * Allows children to send validation data up to their parent.
   * @param {Object} results - the results
   * @param {Object} args
   * @param {String} args.$registerAs - the $registeredAs key
   * @param {String | Number} args.$scope - the $scope key
   */
  function injectChildResultsIntoParent (results, { $registerAs: key, $scope: childScope = CollectFlag.COLLECT_ALL }) {
    if (
      $scope === CollectFlag.COLLECT_NONE ||
      childScope === CollectFlag.COLLECT_NONE ||
      (
        $scope !== CollectFlag.COLLECT_ALL &&
        $scope !== childScope
      )
    ) return
    childResultsRaw[key] = results
    childResultsKeys.value.push(key)
  }

  /**
   * Allows children to remove the validation data from their parent, before getting destroyed.
   * @param {String} key - the registeredAs key
   */
  function removeChildResultsFromParent (key) {
    // remove the key
    childResultsKeys.value = childResultsKeys.value.filter(childKey => childKey !== key)
    // remove the stored data for the key
    delete childResultsRaw[key]
  }

  // inject the `injectChildResultsIntoParent` method, into the current scope
  const sendValidationResultsToParent = inject(VuelidateInjectChildResults, () => {})
  // provide to all of it's children the send results to parent function
  provide(VuelidateInjectChildResults, injectChildResultsIntoParent)

  const removeValidationResultsFromParent = inject(VuelidateRemoveChildResults, () => {})
  // provide to all of it's children the remove results  function
  provide(VuelidateRemoveChildResults, removeChildResultsFromParent)

  return { childResults, sendValidationResultsToParent, removeValidationResultsFromParent }
}

/**
 * Composition API compatible Vuelidate
 * Use inside the `setup` lifecycle hook
 * @param {Object|null} validations - Validations Object
 * @param {Object} state - State object
 * @param {Object} [globalConfig = {}] - Config Object
 * @param {String} [globalConfig.$registerAs] - Config Object
 * @param {String | Number} [globalConfig.$scope] - A scope to limit child component registration
 * @param {Boolean} [globalConfig.$deoptimize] - A flag to force dynamic validation schemes
 * @return {UnwrapRef<*>}
 */
export function useVuelidate (validations, state, globalConfig = {}) {
  let { $registerAs, $scope } = globalConfig
  const canOptimize = !globalConfig.$deoptimize || !validations || (validations && !isRef(validations))

  const instance = getCurrentInstance()

  // if there is no registration name, add one.
  if (!$registerAs) {
    // NOTE:
    // ._uid // Vue 2.x Composition-API plugin
    // .uid // Vue 3.0
    const uid = instance.uid || instance._uid
    $registerAs = `_vuelidate_${uid}`
  }
  const validationResults = ref({})
  const resultsCache = new Map()

  const { childResults, sendValidationResultsToParent, removeValidationResultsFromParent } = nestedValidations({ $scope })

  // Options API
  if (!validations && instance.type.validations) {
    const rules = instance.type.validations

    state = ref({})
    onBeforeMount(() => {
      // Delay binding state to validations defined with the Options API until mounting, when the data
      // has been attached to the component instance. From that point on it will be reactive.
      state.value = instance.proxy

      // helper proxy for instance property access. It makes every reference
      // reactive for the validation function
      function ComputedProxyFactory (target) {
        return new Proxy(target, {
          get (target, prop, receiver) {
            return (typeof target[prop] === 'object')
              ? ComputedProxyFactory(target[prop])
              : computed(() => target[prop])
          }
        })
      }

      watch(() => isFunction(rules) ? rules.call(instance.proxy, new ComputedProxyFactory(instance.proxy)) : rules,
        (validations) => {
          validationResults.value = setValidations({
            validations,
            state,
            childResults,
            resultsCache,
            globalConfig
          })
        }, { immediate: true })
    })

    globalConfig = instance.type.validationsConfig || {}
  } else {
    validationResults.value = !canOptimize ? computed(() => setValidations({
      validations,
      state,
      childResults,
      resultsCache,
      globalConfig
    })) : setValidations({
      validations,
      state,
      childResults,
      resultsCache,
      globalConfig
    })
  }

  // send all the data to the parent when the function is invoked inside setup.
  sendValidationResultsToParent(validationResults, { $registerAs, $scope })
  // before this component is destroyed, remove all the data from the parent.
  onBeforeUnmount(() => removeValidationResultsFromParent($registerAs))

  // TODO: Change into reactive + watch
  return computed(() => {
    return {
      ...unwrap(validationResults.value),
      ...childResults.value
    }
  })
}

export default useVuelidate

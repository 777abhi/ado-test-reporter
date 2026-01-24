@global_tag @smoke
Feature: Cucumber Syntax Showcase
  In order to understand Gherkin syntax
  As a developer or automation engineer
  I want to see all possible elements in one file

  Description can span multiple lines.
  It supports Markdown in some reporters.

  Background: Common steps for all scenarios in this feature
    Given the application is initialized
    And the user is logged in as "admin"

  @sanity @TC_860
  Scenario: Basic Scenario with all step keywords and comments
    # This is a comment
    Given I have a basic step
    When I perform an action
    Then I expect a result
    And I expect another result
    But I do not expect an error
    * I can also use a bullet point for any step type

  @rule_tag
  Rule: Business Rules can group scenarios (Gherkin 6+)
    The Rule keyword is used to represent a business rule.

    @edge_case @TC_861
    Scenario: Inline Doc Strings
      Given I have a text field
      When I enter the following multi-line text:
        """
        This is a Doc String.
        It preserves newlines and whitespace.
        """
      # Alternative syntax using tildes
      And I can also use tildes:
      Then the field should contain the text

    @TC_848
    Scenario: Data Tables
      Given the following users exist:
        | name  | email             | role  |
        | Alice | alice@example.com | admin |
        | Bob   | bob@example.com   | user  |
      When I query for "Alice"
      Then I should get:
        | property | value             |
        | name     | Alice             |
        | email    | alice@example.com |

    @data_driven @TC_849
    Scenario Outline: Data Driven Test (Scenario Template)
      Given I have <start> cucumbers
      When I eat <eat> cucumbers
      Then I should have <left> cucumbers
    # You can have multiple Examples tables with different tags

      @positive
      Examples: Successful eating
        | start | eat | left |
        |    12 |   5 |    7 |
        |    20 |   5 |   15 |

      @negative
      Examples: Edge cases
        | start | eat | left |
        |     0 |   0 |    0 |
        |     5 |   5 |    0 |

    @TC_850
    Scenario: Parameter Types and Expressions
    # These rely on Cucumber Expressions definitions in the glue code
      Given I have 42 cucumbers
      And I wait for 1.5 seconds
      And I select the "blue" pill
    # Anonymous parameter
      When I fly to "Mars"

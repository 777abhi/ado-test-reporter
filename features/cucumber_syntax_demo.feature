@global_tag @travel
Feature: Travel Support Services
  In order to ensure a smooth journey
  As a traveler
  I want access to support and travel tools

  Background:
    Given I am a registered traveler
    And I have an upcoming trip

  @sanity @TC_860
  Scenario: Contact Customer Support
    Given I have a question about my booking
    When I open the support chat
    Then I should be connected to a travel agent
    And I should be able to send a message

  @rule_tag
  Rule: Feedback Collection

    @edge_case @TC_861
    Scenario: Submit Feedback
      Given I have completed a trip
      When I write the following review:
        """
        Great service!
        The flight was on time.
        """
      Then the review should be submitted successfully

    @TC_848
    Scenario: Check Visa Requirements
      Given the following destinations:
        | country | visa_required |
        | USA     | Yes           |
        | France  | No            |
      When I check requirements for "USA"
      Then I should be informed that a Visa is required

    @data_driven @TC_849
    Scenario Outline: Group Booking Discounts
      Given I am booking for <travelers> people
      When I check the price
      Then I should receive a <discount>% discount

      @positive
      Examples: Large Groups
        | travelers | discount |
        |        10 |       15 |
        |        20 |       25 |

      @negative
      Examples: Small Groups
        | travelers | discount |
        |         1 |        0 |
        |         5 |        0 |

    @TC_850
    Scenario: Currency Converter
      Given I have 100 USD
      And the exchange rate is 0.85
      When I convert to "EUR"
      Then I should result in 85 EUR
